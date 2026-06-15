# 🏋️ Academia Lembretes — Backend

Backend Node.js para envio automático de lembretes de treino via **WhatsApp (Twilio)** e **E-mail (Gmail)**.

---

## ✅ Pré-requisitos

- Conta no [Twilio](https://www.twilio.com) (gratuita para testes)
- Conta Gmail com **Senha de App** ativada
- Conta no [Railway](https://railway.app) ou [Render](https://render.com) (gratuitos)

---

## 🔑 1. Configurar o Twilio (WhatsApp)

1. Crie uma conta em [twilio.com](https://www.twilio.com)
2. No painel, vá em **Messaging → Try it out → Send a WhatsApp message**
3. Siga as instruções para ativar o **Sandbox do WhatsApp**
4. Anote:
   - `Account SID` (começa com `AC...`)
   - `Auth Token`
   - Número do sandbox: `whatsapp:+14155238886`

> 💡 Para produção, solicite um número WhatsApp Business aprovado pelo Meta.

---

## 📧 2. Configurar Gmail (Senha de App)

1. Acesse [myaccount.google.com](https://myaccount.google.com)
2. Vá em **Segurança → Verificação em duas etapas** (ative se necessário)
3. Depois vá em **Senhas de app**
4. Selecione "E-mail" e "Windows" → clique em **Gerar**
5. Copie a senha de 16 caracteres gerada

---

## 🚀 3. Deploy no Railway (Recomendado)

### Opção A — Via GitHub (mais fácil)

1. Suba este projeto para um repositório GitHub
2. Acesse [railway.app](https://railway.app) e faça login
3. Clique em **New Project → Deploy from GitHub repo**
4. Selecione o repositório
5. Vá em **Variables** e adicione todas as variáveis abaixo:

```
TWILIO_ACCOUNT_SID    = ACxxxxxxxx...
TWILIO_AUTH_TOKEN     = xxxxxxxx...
TWILIO_WHATSAPP_FROM  = whatsapp:+14155238886
GMAIL_USER            = seuemail@gmail.com
GMAIL_APP_PASSWORD    = xxxx xxxx xxxx xxxx
```

6. O Railway detecta `package.json` e inicia com `npm start` automaticamente
7. Vá em **Settings → Networking → Generate Domain** para obter sua URL pública

---

### Opção B — Deploy no Render

1. Suba para GitHub
2. Acesse [render.com](https://render.com) → **New → Web Service**
3. Conecte o repositório
4. Configure:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
5. Adicione as variáveis de ambiente na aba **Environment**
6. Clique em **Create Web Service**

---

## 🔗 4. Conectar o formulário ao backend

Após o deploy, você terá uma URL como:
- Railway: `https://academia-lembretes.up.railway.app`
- Render: `https://academia-lembretes.onrender.com`

Substitua `https://SUA-URL-AQUI` no código do artifact pelo endereço acima.

---

## 📡 Endpoints disponíveis

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/api/cadastrar` | Cadastra aluno e envia confirmação |
| `GET` | `/api/alunos` | Lista todos os alunos |
| `DELETE` | `/api/alunos/:id` | Remove um aluno |
| `GET` | `/health` | Status do servidor |

### Exemplo de payload — POST /api/cadastrar

```json
{
  "nome": "João Silva",
  "email": "joao@email.com",
  "cel": "(11) 99999-9999",
  "day": "Segunda",
  "time": "18:00",
  "wa": true,
  "email_notify": true
}
```

---

## ⏰ Como funcionam os lembretes

- Um **cron job** roda a cada minuto verificando os cadastros
- Se o horário atual = horário do treino − 1 hora, o lembrete é disparado
- Exemplo: treino às `18:00` → lembrete enviado às `17:00` toda segunda-feira

---

## 🧪 Testando localmente

```bash
# 1. Clone e instale
npm install

# 2. Crie o arquivo .env a partir do exemplo
cp .env.example .env
# Edite .env com suas credenciais reais

# 3. Inicie o servidor
npm run dev

# 4. Teste o cadastro
curl -X POST http://localhost:3001/api/cadastrar \
  -H "Content-Type: application/json" \
  -d '{"nome":"Teste","email":"teste@gmail.com","cel":"(11) 91234-5678","day":"Segunda","time":"18:00","wa":true,"email_notify":true}'
```

---

## 📁 Estrutura do projeto

```
academia-backend/
├── server.js          # Servidor principal
├── package.json
├── .env.example       # Modelo de variáveis de ambiente
├── .gitignore
├── README.md
└── data/
    └── alunos.json    # Banco de dados (criado automaticamente)
```

---

## ⚠️ Importante

- O arquivo `data/alunos.json` é criado automaticamente
- **Não suba o `.env` para o GitHub** — ele já está no `.gitignore`
- O Render hiberna serviços gratuitos após inatividade; considere usar Railway para maior estabilidade
