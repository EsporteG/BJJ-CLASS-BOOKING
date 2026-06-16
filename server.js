require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const nodemailer = require("nodemailer");
const twilio = require("twilio");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const { pool, initDB } = require("./db");

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

// ─── Twilio ───────────────────────────────────────────────────────────────────
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const TWILIO_FROM = process.env.TWILIO_WHATSAPP_FROM;

// ─── Gmail ────────────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
});

// ─── Rate limiting ────────────────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Muitas tentativas. Tente novamente em 15 minutos." },
  standardHeaders: true,
  legacyHeaders: false,
});

const recoveryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: "Muitas solicitações. Tente novamente em 1 hora." },
});

function gerarToken() {
  return crypto.randomBytes(32).toString("hex");
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || "academia-secret-2024";

function auth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Não autenticado." });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Sessão expirada. Faça login novamente." });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Acesso negado." });
  next();
}

// ─── Notificações ─────────────────────────────────────────────────────────────
async function sendWhatsApp(to, message) {
  const phone = to.replace(/\D/g, "");
  const full = phone.startsWith("55") ? phone : "55" + phone;
  try {
    await twilioClient.messages.create({ from: TWILIO_FROM, to: `whatsapp:+${full}`, body: message });
    console.log(`✅ WhatsApp → +${full}`);
  } catch (err) {
    console.error(`❌ WhatsApp → +${full}:`, err.message);
  }
}

async function sendEmail(to, nome, day, time, tipo) {
  const tipoLabel = tipo === "kids1" ? "Kids 1" : tipo === "kids2" ? "Kids 2" : "Adulto";
  const html = `
    <!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#111;padding:20px">
    <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
      <div style="background:#000;padding:24px;text-align:center">
        <div style="color:#fff;font-size:26px;font-weight:900;letter-spacing:2px">ALPHA</div>
        <div style="color:#aaa;font-size:11px;letter-spacing:3px;margin-top:2px">ESCOLA DE JIU-JITSU</div>
      </div>
      <div style="padding:28px">
        <p style="font-size:16px;color:#333">Olá, <strong>${nome}</strong>!</p>
        <p style="font-size:15px;color:#555">Seu treino de <strong>${tipoLabel}</strong> — <strong>${day}</strong> começa em <strong>1 hora</strong>, às <strong>${time}h</strong>.</p>
        <div style="background:#f5f5f5;border-radius:8px;padding:16px;margin:20px 0;text-align:center">
          <p style="margin:0;font-size:18px;font-weight:bold;color:#000">📅 ${day} · ⏰ ${time}h · ${tipoLabel}</p>
        </div>
        <p style="font-size:13px;color:#888">OSS! 🤜🤛</p>
      </div>
      <div style="background:#000;padding:12px;text-align:center">
        <p style="margin:0;font-size:11px;color:#666">Alpha Escola de Jiu-Jitsu · (12) 98286-0002</p>
      </div>
    </div></body></html>`;
  try {
    await transporter.sendMail({
      from: `"Alpha Jiu-Jitsu" <${process.env.GMAIL_USER}>`,
      to,
      subject: `⏰ Lembrete: treino de ${tipoLabel} em 1 hora — ${time}h`,
      html,
    });
    console.log(`✅ E-mail → ${to}`);
  } catch (err) {
    console.error(`❌ E-mail → ${to}:`, err.message);
  }
}

// ─── Rotas ────────────────────────────────────────────────────────────────────

// POST /api/registrar
app.post("/api/registrar", async (req, res) => {
  const { nome, email, senha, cel } = req.body;
  if (!nome || !email || !senha || !cel)
    return res.status(400).json({ error: "Preencha todos os campos." });
  if (senha.length < 6)
    return res.status(400).json({ error: "Senha deve ter no mínimo 6 caracteres." });

  const { rows: ex } = await pool.query("SELECT id FROM usuarios WHERE email=$1", [email]);
  if (ex.length) return res.status(400).json({ error: "E-mail já cadastrado." });

  const hash = await bcrypt.hash(senha, 10);
  const id = Date.now();
  const tokenVerif = gerarToken();

  await pool.query(
    "INSERT INTO usuarios (id,nome,email,senha,cel,role,email_verificado,token_verificacao,created_at) VALUES ($1,$2,$3,$4,$5,'aluno',false,$6,NOW())",
    [id, nome, email, hash, cel, tokenVerif]
  );
  console.log(`📋 Novo aluno: ${nome}`);

  const baseUrl = `${req.protocol}://${req.get("host")}`;
  await transporter.sendMail({
    from: `"Alpha Jiu-Jitsu" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: "✅ Confirme seu e-mail — Alpha Jiu-Jitsu",
    html: `
      <body style="font-family:Arial,sans-serif;background:#111;padding:20px">
      <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
        <div style="background:#000;padding:24px;text-align:center">
          <div style="color:#fff;font-size:26px;font-weight:900;letter-spacing:2px">ALPHA</div>
          <div style="color:#aaa;font-size:11px;letter-spacing:3px">ESCOLA DE JIU-JITSU</div>
        </div>
        <div style="padding:28px">
          <p style="font-size:16px;color:#333">Olá, <strong>${nome}</strong>!</p>
          <p style="font-size:14px;color:#555;margin-top:8px">Clique no botão abaixo para confirmar seu e-mail e ativar sua conta.</p>
          <div style="text-align:center;margin:28px 0">
            <a href="${baseUrl}/api/verificar-email/${tokenVerif}" style="background:#C0392B;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">Confirmar e-mail</a>
          </div>
          <p style="font-size:12px;color:#aaa">Se não foi você, ignore este e-mail.</p>
        </div>
      </div></body>`
  }).catch(err => console.error("❌ E-mail verificação:", err.message));

  return res.json({ success: true, message: "Conta criada! Verifique seu e-mail para ativar." });
});

// GET /api/verificar-email/:token
app.get("/api/verificar-email/:token", async (req, res) => {
  const { rows } = await pool.query(
    "UPDATE usuarios SET email_verificado=true, token_verificacao=NULL WHERE token_verificacao=$1 RETURNING id",
    [req.params.token]
  );
  if (!rows.length) return res.redirect("/verificar-email.html?status=invalido");
  res.redirect("/verificar-email.html?status=ok");
});

// POST /api/solicitar-recuperacao
app.post("/api/solicitar-recuperacao", recoveryLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "E-mail obrigatório." });

  const { rows } = await pool.query("SELECT id, nome FROM usuarios WHERE email=$1", [email]);
  // Sempre retorna sucesso para não revelar se e-mail existe
  if (!rows.length) return res.json({ success: true });

  const token = gerarToken();
  const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hora
  await pool.query(
    "UPDATE usuarios SET token_recuperacao=$1, token_expiry=$2 WHERE email=$3",
    [token, expiry, email]
  );

  const baseUrl = `${req.protocol}://${req.get("host")}`;
  await transporter.sendMail({
    from: `"Alpha Jiu-Jitsu" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: "🔑 Recuperação de senha — Alpha Jiu-Jitsu",
    html: `
      <body style="font-family:Arial,sans-serif;background:#111;padding:20px">
      <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
        <div style="background:#000;padding:24px;text-align:center">
          <div style="color:#fff;font-size:26px;font-weight:900;letter-spacing:2px">ALPHA</div>
          <div style="color:#aaa;font-size:11px;letter-spacing:3px">ESCOLA DE JIU-JITSU</div>
        </div>
        <div style="padding:28px">
          <p style="font-size:16px;color:#333">Olá, <strong>${rows[0].nome}</strong>!</p>
          <p style="font-size:14px;color:#555;margin-top:8px">Recebemos uma solicitação para redefinir sua senha. O link expira em <strong>1 hora</strong>.</p>
          <div style="text-align:center;margin:28px 0">
            <a href="${baseUrl}/redefinir-senha.html?token=${token}" style="background:#C0392B;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">Redefinir senha</a>
          </div>
          <p style="font-size:12px;color:#aaa">Se não solicitou, ignore este e-mail.</p>
        </div>
      </div></body>`
  }).catch(err => console.error("❌ E-mail recuperação:", err.message));

  res.json({ success: true });
});

// POST /api/redefinir-senha
app.post("/api/redefinir-senha", async (req, res) => {
  const { token, senha } = req.body;
  if (!token || !senha) return res.status(400).json({ error: "Dados inválidos." });
  if (senha.length < 6) return res.status(400).json({ error: "Senha deve ter no mínimo 6 caracteres." });

  const { rows } = await pool.query(
    "SELECT id FROM usuarios WHERE token_recuperacao=$1 AND token_expiry > NOW()",
    [token]
  );
  if (!rows.length) return res.status(400).json({ error: "Link inválido ou expirado." });

  const hash = await bcrypt.hash(senha, 10);
  await pool.query(
    "UPDATE usuarios SET senha=$1, token_recuperacao=NULL, token_expiry=NULL WHERE id=$2",
    [hash, rows[0].id]
  );
  res.json({ success: true });
});

// POST /api/login — com rate limiting
app.post("/api/login", loginLimiter, async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.status(400).json({ error: "E-mail e senha são obrigatórios." });

  if (email === process.env.ADMIN_EMAIL) {
    if (senha !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: "Senha incorreta." });
    const token = jwt.sign({ id: 0, nome: "Professor", role: "admin" }, JWT_SECRET, { expiresIn: "7d" });
    return res.json({ success: true, token, role: "admin", nome: "Professor" });
  }

  const { rows } = await pool.query("SELECT * FROM usuarios WHERE email=$1", [email]);
  if (!rows.length) return res.status(401).json({ error: "Usuário não encontrado." });
  const user = rows[0];

  const ok = await bcrypt.compare(senha, user.senha);
  if (!ok) return res.status(401).json({ error: "Senha incorreta." });

  if (!user.email_verificado) {
    return res.status(403).json({ error: "E-mail não verificado. Verifique sua caixa de entrada." });
  }

  const token = jwt.sign({ id: user.id, nome: user.nome, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
  return res.json({ success: true, token, role: user.role, nome: user.nome });
});

// GET /api/me
app.get("/api/me", auth, async (req, res) => {
  if (req.user.role === "admin") return res.json({ role: "admin", nome: "Professor" });
  const { rows } = await pool.query(
    "SELECT id,nome,email,cel,role,created_at FROM usuarios WHERE id=$1",
    [req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Usuário não encontrado." });
  res.json(rows[0]);
});

// POST /api/agendar — cria agendamento específico com data
app.post("/api/agendar", auth, async (req, res) => {
  const { data, day, time, tipo, wa, email_notify } = req.body;
  if (!data || !day || !time || !tipo)
    return res.status(400).json({ error: "Data, dia, horário e turma são obrigatórios." });

  const { rows: user } = await pool.query("SELECT nome,cel,email FROM usuarios WHERE id=$1", [req.user.id]);
  if (!user.length) return res.status(404).json({ error: "Usuário não encontrado." });

  // Impede agendamento duplicado no mesmo slot
  const { rows: dup } = await pool.query(
    "SELECT id FROM agendamentos WHERE usuario_id=$1 AND data=$2 AND time=$3",
    [req.user.id, data, time]
  );
  if (dup.length) return res.status(400).json({ error: "Você já tem um agendamento nesse horário." });

  const { rows: ag } = await pool.query(
    `INSERT INTO agendamentos (usuario_id,usuario_nome,data,day,time,tipo,status,wa,email_notify)
     VALUES ($1,$2,$3,$4,$5,$6,'agendado',$7,$8) RETURNING id`,
    [req.user.id, user[0].nome, data, day, time, tipo, !!wa, !!email_notify]
  );

  const tipoLabel = tipo === "kids1" ? "Kids 1" : tipo === "kids2" ? "Kids 2" : "Adulto";
  const dataFmt = new Date(data + "T12:00:00").toLocaleDateString("pt-BR");
  console.log(`📅 Agendado: ${user[0].nome} — ${tipoLabel} ${day} ${dataFmt} ${time}h`);

  const confirmMsg = `OSS, ${user[0].nome}! ✅ Aula agendada: *${tipoLabel} — ${day} ${dataFmt} às ${time}h*. 🤜🤛`;
  if (wa) await sendWhatsApp(user[0].cel, confirmMsg);
  if (email_notify) await sendEmail(user[0].email, user[0].nome, `${day} ${dataFmt}`, time, tipo);

  res.json({ success: true, id: ag[0].id });
});

// GET /api/agendamentos — admin vê todos; aluno vê os seus
app.get("/api/agendamentos", auth, async (req, res) => {
  if (req.user.role === "admin") {
    const { rows } = await pool.query(
      `SELECT a.*, u.cel, u.email FROM agendamentos a
       LEFT JOIN usuarios u ON u.id = a.usuario_id
       ORDER BY a.data DESC, a.time ASC`
    );
    return res.json(rows);
  }
  const { rows } = await pool.query(
    "SELECT * FROM agendamentos WHERE usuario_id=$1 ORDER BY data DESC, time ASC",
    [req.user.id]
  );
  res.json(rows);
});

// PATCH /api/agendamentos/:id/status — professor marca presença
app.patch("/api/agendamentos/:id/status", auth, adminOnly, async (req, res) => {
  const { status } = req.body;
  if (!["presente", "faltou", "agendado"].includes(status))
    return res.status(400).json({ error: "Status inválido." });

  const { rowCount } = await pool.query(
    "UPDATE agendamentos SET status=$1 WHERE id=$2",
    [status, Number(req.params.id)]
  );
  if (!rowCount) return res.status(404).json({ error: "Agendamento não encontrado." });
  res.json({ success: true });
});

// DELETE /api/agendamentos/:id — cancelar (aluno cancela o seu, admin cancela qualquer)
app.delete("/api/agendamentos/:id", auth, async (req, res) => {
  const id = Number(req.params.id);
  const cond = req.user.role === "admin"
    ? "WHERE id=$1"
    : "WHERE id=$1 AND usuario_id=$2";
  const params = req.user.role === "admin" ? [id] : [id, req.user.id];
  const { rowCount } = await pool.query(`DELETE FROM agendamentos ${cond}`, params);
  if (!rowCount) return res.status(404).json({ error: "Agendamento não encontrado." });
  res.json({ success: true });
});

// GET /api/alunos (admin) — inclui total_aulas e aulas_grau calculados
app.get("/api/alunos", auth, adminOnly, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      u.id, u.nome, u.email, u.cel, u.faixa, u.grau, u.created_at,
      COALESCE((
        SELECT COUNT(*) FROM agendamentos
        WHERE usuario_id = u.id AND status = 'presente'
      ), 0)::int AS total_aulas,
      COALESCE((
        SELECT COUNT(*) FROM agendamentos
        WHERE usuario_id = u.id AND status = 'presente'
          AND created_at > COALESCE(
            (SELECT MAX(created_at) FROM promocoes WHERE usuario_id = u.id),
            u.created_at - interval '1 second'
          )
      ), 0)::int AS aulas_grau
    FROM usuarios u
    WHERE u.role = 'aluno'
    ORDER BY u.created_at DESC
  `);
  res.json(rows);
});

// PATCH /api/alunos/:id/faixa — professor define faixa e grau manualmente
app.patch("/api/alunos/:id/faixa", auth, adminOnly, async (req, res) => {
  const { faixa, grau } = req.body;
  const faixas = ["branca","cinza","amarela","laranja","verde","azul","roxa","marrom","preta"];
  if (!faixas.includes(faixa)) return res.status(400).json({ error: "Faixa inválida." });
  if (grau < 0 || grau > 4) return res.status(400).json({ error: "Grau deve ser entre 0 e 4." });

  const { rowCount } = await pool.query(
    "UPDATE usuarios SET faixa=$1, grau=$2 WHERE id=$3 AND role='aluno'",
    [faixa, grau, Number(req.params.id)]
  );
  if (!rowCount) return res.status(404).json({ error: "Aluno não encontrado." });

  // Registra como promoção manual com data hoje
  await pool.query(
    "INSERT INTO promocoes (usuario_id, faixa, grau, data) VALUES ($1,$2,$3,CURRENT_DATE)",
    [Number(req.params.id), faixa, grau]
  );
  res.json({ success: true });
});

// GET /api/alunos/:id/promocoes — histórico de promoções
app.get("/api/alunos/:id/promocoes", auth, adminOnly, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT faixa, grau, data FROM promocoes WHERE usuario_id=$1 ORDER BY data DESC",
    [Number(req.params.id)]
  );
  res.json(rows);
});

// DELETE /api/alunos/:id (admin)
app.delete("/api/alunos/:id", auth, adminOnly, async (req, res) => {
  const { rowCount } = await pool.query("DELETE FROM usuarios WHERE id=$1 AND role='aluno'", [Number(req.params.id)]);
  if (!rowCount) return res.status(404).json({ error: "Aluno não encontrado." });
  res.json({ success: true });
});

// GET /health
app.get("/health", (_, res) => res.json({ status: "ok", time: new Date() }));

// ─── Cron: lembretes 1h antes dos agendamentos do dia ────────────────────────
cron.schedule("* * * * *", async () => {
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes();
  const today = now.toISOString().split("T")[0];
  const { rows } = await pool.query(
    `SELECT a.*, u.cel, u.email FROM agendamentos a
     JOIN usuarios u ON u.id = a.usuario_id
     WHERE a.data=$1 AND a.status='agendado' AND (a.wa=true OR a.email_notify=true)`,
    [today]
  );
  for (const ag of rows) {
    const [th, tm] = ag.time.split(":").map(Number);
    const reminderH = th - 1;
    if (reminderH < 0 || h !== reminderH || m !== (tm || 0)) continue;
    console.log(`⏰ Lembrete → ${ag.usuario_nome} (${ag.day} ${ag.time}h)`);
    const msg = `⏰ OSS ${ag.usuario_nome}! Sua aula começa em *1 hora* (${ag.time}h). Bora! 🤜🤛`;
    if (ag.wa) await sendWhatsApp(ag.cel, msg);
    if (ag.email_notify) await sendEmail(ag.email, ag.usuario_nome, ag.day, ag.time, ag.tipo);
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor na porta ${PORT}`);
    console.log(`🔐 Admin: ${process.env.ADMIN_EMAIL || "⚠️  ADMIN_EMAIL não configurado"}`);
  });
}).catch((err) => {
  console.error("❌ Erro ao conectar ao banco:", err.message);
  process.exit(1);
});
