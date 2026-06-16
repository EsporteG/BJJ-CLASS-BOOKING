const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id           BIGINT PRIMARY KEY,
      nome         VARCHAR(255) NOT NULL,
      email        VARCHAR(255) UNIQUE NOT NULL,
      senha        VARCHAR(255) NOT NULL,
      cel          VARCHAR(30),
      faixa        VARCHAR(20) DEFAULT 'branca',
      grau         INTEGER DEFAULT 0,
      role         VARCHAR(20) DEFAULT 'aluno',
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Adiciona colunas caso a tabela já existia sem elas
  await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS faixa VARCHAR(20) DEFAULT 'branca'`);
  await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS grau INTEGER DEFAULT 0`);
  // DEFAULT true para não bloquear usuários existentes
  await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email_verificado BOOLEAN DEFAULT true`);
  await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS token_verificacao VARCHAR(64)`);
  await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS token_recuperacao VARCHAR(64)`);
  await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS token_expiry TIMESTAMPTZ`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agendamentos (
      id           BIGSERIAL PRIMARY KEY,
      usuario_id   BIGINT NOT NULL,
      usuario_nome VARCHAR(255),
      data         DATE NOT NULL,
      day          VARCHAR(20) NOT NULL,
      time         VARCHAR(10) NOT NULL,
      tipo         VARCHAR(20) NOT NULL,
      status       VARCHAR(20) DEFAULT 'agendado',
      wa           BOOLEAN DEFAULT false,
      email_notify BOOLEAN DEFAULT false,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS promocoes (
      id           BIGSERIAL PRIMARY KEY,
      usuario_id   BIGINT NOT NULL,
      faixa        VARCHAR(20) NOT NULL,
      grau         INTEGER NOT NULL,
      data         DATE DEFAULT CURRENT_DATE,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  console.log("✅ Banco de dados pronto");
}

module.exports = { pool, initDB };
