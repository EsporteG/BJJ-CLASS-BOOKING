require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const nodemailer = require("nodemailer");
const twilio = require("twilio");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

// ─── Configuração Twilio ───────────────────────────────────────────────────
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
const TWILIO_FROM = process.env.TWILIO_WHATSAPP_FROM; // ex: whatsapp:+14155238886

// ─── Configuração Gmail ────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD, // Senha de app do Google
  },
});

// ─── Banco de dados simples (JSON) ─────────────────────────────────────────
const DB_PATH = path.join(__dirname, "data", "alunos.json");

function loadDB() {
  if (!fs.existsSync(path.dirname(DB_PATH))) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify([]));
  }
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ─── Mapeamento de dias para cron ──────────────────────────────────────────
const DAY_MAP = {
  Segunda: "1",
  "Terça": "2",
  Quarta: "3",
  Quinta: "4",
  Sexta: "5",
  "Sábado": "6",
  Domingo: "0",
};

// ─── Enviar WhatsApp ───────────────────────────────────────────────────────
async function sendWhatsApp(to, message) {
  const phone = to.replace(/\D/g, "");
  const fullPhone = phone.startsWith("55") ? phone : "55" + phone;
  try {
    await twilioClient.messages.create({
      from: TWILIO_FROM,
      to: `whatsapp:+${fullPhone}`,
      body: message,
    });
    console.log(`✅ WhatsApp enviado para +${fullPhone}`);
    return true;
  } catch (err) {
    console.error(`❌ Erro WhatsApp para +${fullPhone}:`, err.message);
    return false;
  }
}

// ─── Enviar E-mail ─────────────────────────────────────────────────────────
async function sendEmail(to, nome, day, time) {
  const html = `
    <!DOCTYPE html>
    <html>
    <body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:20px">
      <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e5e5">
        <div style="background:#534AB7;padding:24px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:22px">🏋️ Lembrete de Treino</h1>
        </div>
        <div style="padding:28px">
          <p style="font-size:16px;color:#333">Olá, <strong>${nome}</strong>!</p>
          <p style="font-size:15px;color:#555">
            Seu treino de <strong>${day}</strong> começa em <strong>1 hora</strong>, às <strong>${time}h</strong>.
          </p>
          <div style="background:#EEEDFE;border-radius:8px;padding:16px;margin:20px 0;text-align:center">
            <p style="margin:0;font-size:18px;font-weight:bold;color:#3C3489">
              📅 ${day} · ⏰ ${time}h
            </p>
          </div>
          <p style="font-size:14px;color:#888">Não se esqueça de trazer sua garrafinha de água e toalha! 💧</p>
          <p style="font-size:14px;color:#888">Até logo! 💪</p>
        </div>
        <div style="background:#f9f9f9;padding:12px;text-align:center;border-top:1px solid #eee">
          <p style="margin:0;font-size:12px;color:#aaa">Sistema de lembretes — Academia</p>
        </div>
      </div>
    </body>
    </html>
  `;
  try {
    await transporter.sendMail({
      from: `"Academia Lembretes" <${process.env.GMAIL_USER}>`,
      to,
      subject: `🏋️ Lembrete: seu treino de ${day} começa em 1 hora!`,
      html,
    });
    console.log(`✅ E-mail enviado para ${to}`);
    return true;
  } catch (err) {
    console.error(`❌ Erro e-mail para ${to}:`, err.message);
    return false;
  }
}

// ─── Rotas da API ───────────────────────────────────────────────────────────

// POST /api/cadastrar
app.post("/api/cadastrar", async (req, res) => {
  const { nome, email, cel, day, time, wa, email_notify } = req.body;

  if (!nome || !email || !cel || !day || !time) {
    return res.status(400).json({ error: "Campos obrigatórios faltando." });
  }

  const alunos = loadDB();
  const aluno = {
    id: Date.now(),
    nome,
    email,
    cel,
    day,
    time,
    wa: !!wa,
    email_notify: !!email_notify,
    createdAt: new Date().toISOString(),
  };
  alunos.push(aluno);
  saveDB(alunos);

  console.log(`📋 Novo cadastro: ${nome} — ${day} ${time}h`);

  // Enviar confirmação imediata
  const confirmMsg = `Olá ${nome}! ✅ Seu treino de *${day} às ${time}h* foi confirmado. Você receberá um lembrete 1h antes. 💪`;
  if (wa) await sendWhatsApp(cel, confirmMsg);
  if (email_notify) await sendEmail(email, nome, day, time);

  return res.json({ success: true, aluno });
});

// GET /api/alunos
app.get("/api/alunos", (req, res) => {
  const alunos = loadDB();
  res.json(alunos);
});

// DELETE /api/alunos/:id
app.delete("/api/alunos/:id", (req, res) => {
  let alunos = loadDB();
  const antes = alunos.length;
  alunos = alunos.filter((a) => a.id !== Number(req.params.id));
  if (alunos.length === antes) {
    return res.status(404).json({ error: "Aluno não encontrado." });
  }
  saveDB(alunos);
  res.json({ success: true });
});

// GET /health
app.get("/health", (_, res) => res.json({ status: "ok", time: new Date() }));

// ─── Cron: verifica lembretes a cada minuto ─────────────────────────────────
cron.schedule("* * * * *", async () => {
  const now = new Date();
  // Hora e minuto atuais
  const h = now.getHours();
  const m = now.getMinutes();
  const dow = now.getDay(); // 0=dom, 1=seg...

  const alunos = loadDB();

  for (const aluno of alunos) {
    // Dia da semana do aluno
    const alunoDoW = Number(DAY_MAP[aluno.day]);
    if (dow !== alunoDoW) continue;

    // Hora do treino - 1h
    const [th] = aluno.time.split(":").map(Number);
    const reminderH = th - 1;
    if (reminderH < 0) continue; // treino às 00h não faz lembrete
    if (h !== reminderH || m !== 0) continue;

    console.log(`⏰ Enviando lembrete para ${aluno.nome} (${aluno.day} ${aluno.time}h)`);
    const msg = `⏰ Lembrete: ${aluno.nome}, seu treino começa em *1 hora* (${aluno.time}h). Bora! 💪🏋️`;
    if (aluno.wa) await sendWhatsApp(aluno.cel, msg);
    if (aluno.email_notify) await sendEmail(aluno.email, aluno.nome, aluno.day, aluno.time);
  }
});

// ─── Start ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📅 Cron de lembretes ativo — verifica a cada minuto`);
});
