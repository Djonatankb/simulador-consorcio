/**
 * Vercel Serverless Function — Backend Simulador de Consórcio Liga Vitória
 * Rota: /api/simulador
 */

const crypto = require('crypto');
let google = null;
try {
  google = require('googleapis').google;
} catch (e) {
  // googleapis não instalado no ambiente local
}

// Cache em memória do Vercel Serverless Instance (para OTPs e Planos)
const memoryCache = new Map();

const kommo = require('../lib/kommo');

// Parâmetros OTP e Integrações
const OTP_MIN = 1500, OTP_RANGE = 8000;
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutos
const AIRTABLE_BASE_DEFAULT = 'appAXa666ayzjld9S';
const SPREADSHEET_ID_DEFAULT = '1FeMY6hfwSix7YR_ndVVxFjcqt2D4JaPWtd38Qc4wP3k';

function getEnv(key, defaultValue = '') {
  return process.env[key] || defaultValue;
}

// Telefone válido (10-11 dígitos)
function telefoneValido(v) {
  const tel = String(v || '').replace(/\D/g, '');
  return /^\d{10,11}$/.test(tel) ? tel : '';
}

// Código OTP com aleatoriedade segura
function codigoOtp() {
  const buf = crypto.randomBytes(4);
  const num = buf.readUInt32BE(0);
  return String(OTP_MIN + (num % OTP_RANGE));
}

// Envia SMS via Comtele
async function enviarSMS(telefone, texto) {
  const apiKey = getEnv('SMS_API_KEY');
  if (!apiKey) throw new Error('SMS_API_KEY não configurada.');

  let n = String(telefone).replace(/\D/g, '');
  if (n.length <= 11) n = '55' + n;

  const resp = await fetch('https://api.comtele.com.br/messages/sms/send', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      receivers: [n],
      message: texto,
      route: getEnv('SMS_ROUTE', '17'),
      tag: 'OTP-Liga'
    })
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.hasError !== false) {
    throw new Error('Falha no envio de SMS Comtele: ' + (data.message || resp.statusText));
  }
}

// Gravação e Atualização no Google Sheets
async function gravarGoogleSheets(camposLinha) {
  if (!google) {
    console.warn('googleapis não carregado no ambiente.');
    return;
  }

  const clientEmail = getEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  let privateKey = getEnv('GOOGLE_PRIVATE_KEY');

  if (!clientEmail || !privateKey) {
    console.log('GOOGLE_SERVICE_ACCOUNT_EMAIL ou GOOGLE_PRIVATE_KEY ausentes.');
    return;
  }

  // Sanitização da Private Key (remove aspas externas e converte \n)
  privateKey = privateKey.replace(/^["']|["']$/g, '').replace(/\\n/g, '\n').trim();

  try {
    const auth = new google.auth.JWT(
      clientEmail,
      null,
      privateKey,
      ['https://www.googleapis.com/auth/spreadsheets']
    );

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = getEnv('GOOGLE_SPREADSHEET_ID', SPREADSHEET_ID_DEFAULT);

    const targetUuid = String(camposLinha.uuid || '').trim();

    const values = [[
      targetUuid,                               // Coluna A: ID (UUID)
      new Date().toISOString(),                 // Coluna B: Data/Hora
      camposLinha.nome || '',                   // Coluna C: Nome
      camposLinha.email || '',                  // Coluna D: Email
      camposLinha.cpf || '',                    // Coluna E: CPF
      camposLinha.telefone || '',               // Coluna F: Telefone
      camposLinha.tipo || '',                   // Coluna G: Tipo
      camposLinha.valor || '',                  // Coluna H: Valor
      camposLinha.plano || '',                  // Coluna I: Plano
      camposLinha.descricao || '',              // Coluna J: Descrição
      camposLinha.credito || '',                // Coluna K: Crédito
      camposLinha.parcela || '',                // Coluna L: Parcela
      camposLinha.pontos || '',                 // Coluna M: Pontos
      camposLinha.dispositivo || '',            // Coluna N: Dispositivo
      camposLinha.url || '',                    // Coluna O: URL
      camposLinha.nome_completo || '',          // Coluna P: Nome Completo
      camposLinha.nascimento || '',             // Coluna Q: Nascimento
      camposLinha.rg || '',                     // Coluna R: RG
      camposLinha.orgao || '',                  // Coluna S: Órgão
      camposLinha.naturalidade || '',           // Coluna T: Naturalidade
      camposLinha.nome_mae || '',               // Coluna U: Nome da Mãe
      camposLinha.endereco || '',               // Coluna V: Endereço
      camposLinha.cep || '',                    // Coluna W: CEP
      camposLinha.status || '',                 // Coluna X: Status
      camposLinha.kommo_lead_id || ''           // Coluna Y: Kommo Lead ID
    ]];

    // 1. Tenta buscar se a ID (targetUuid) já existe na Coluna A
    let rowIndex = -1;
    if (targetUuid) {
      try {
        const getResp = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: 'A:A'
        });
        const rows = getResp.data.values || [];
        for (let i = 0; i < rows.length; i++) {
          if (rows[i] && String(rows[i][0]).trim() === targetUuid) {
            rowIndex = i + 1; // 1-indexed row number no Google Sheets
            break;
          }
        }
      } catch (errSearch) {
        console.warn('Busca de linha por ID falhou:', errSearch?.message);
      }
    }

    if (rowIndex > 0) {
      // 2. Se a linha existir, ATUALIZA a mesma linha na planilha!
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `A${rowIndex}:Y${rowIndex}`,
        valueInputOption: 'USER_ENTERED',
        resource: { values }
      });
      console.log(`✅ Linha ${rowIndex} atualizada no Google Sheets (ID: ${targetUuid})`);
    } else {
      // 3. Se a linha não existir, CRIA uma nova linha na planilha!
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'A:Y',
        valueInputOption: 'USER_ENTERED',
        resource: { values }
      });
      console.log(`✅ Nova linha criada no Google Sheets (ID: ${targetUuid})`);
    }
  } catch (err) {
    console.error('Google Sheets Error:', err?.message || err);
    if (err?.response?.data) {
      console.error('Detalhes Google Sheets:', JSON.stringify(err.response.data));
    }
  }
}

// Handlers das Ações
async function handleSendOtp(body) {
  const tel = telefoneValido(body.telefone);
  if (!tel) return { ok: false, erro: 'Telefone inválido.' };

  const skipSms = getEnv('SKIP_SMS_VERIFICATION', 'true') === 'true';
  const codigo = codigoOtp();
  memoryCache.set(`otp_${tel}`, { codigo, exp: Date.now() + OTP_TTL_MS });

  if (skipSms) {
    return { ok: true, demo_codigo: `${codigo} (Qualquer código aceito)` };
  }

  const apiKey = getEnv('SMS_API_KEY');
  if (!apiKey) {
    // MODO TESTE (Dev/Demo sem chave SMS)
    return { ok: true, demo_codigo: codigo };
  }

  await enviarSMS(tel, `Liga Vitoria Consorcio: seu codigo de verificacao e ${codigo}. Valido por 5 min.`);
  return { ok: true };
}

async function handleVerifyOtp(body) {
  const tel = telefoneValido(body.telefone);
  if (!tel) return { ok: false, erro: 'Telefone inválido.' };

  const codigoReq = String(body.codigo || '').replace(/\D/g, '');
  const cached = memoryCache.get(`otp_${tel}`);
  const skipSms = getEnv('SKIP_SMS_VERIFICATION', 'true') === 'true';

  if (!skipSms) {
    if (!cached || cached.codigo !== codigoReq || Date.now() > cached.exp) {
      return { ok: false, erro: 'Código inválido ou expirado.' };
    }
  }

  const uuid = crypto.randomUUID();
  let kommoLeadId = null;

  // 1. Busca por telefone existente ou cria Lead em Triagem no Kommo CRM
  try {
    kommoLeadId = await kommo.buscarOuCriarLeadKommo(body.nome, body.email, tel, body.tipo);
  } catch (e) {
    console.error('Erro buscarOuCriarLeadKommo:', e);
  }

  // 2. Grava no Google Sheets (se configurado)
  await gravarGoogleSheets({
    nome: body.nome,
    email: body.email,
    telefone: tel,
    tipo: body.tipo,
    dispositivo: body.dispositivo,
    url: body.url,
    uuid: uuid,
    status: 'lead verificado',
    kommo_lead_id: kommoLeadId
  });

  // Limpa OTP usado
  memoryCache.delete(`otp_${tel}`);

  return { ok: true, uuid, kommo_lead_id: kommoLeadId };
}

async function handleGetPlans(body) {
  const valor = Number(body.valor);
  if (!(valor > 0)) return { ok: false, erro: 'Valor inválido.' };

  const tipoRaw = String(body.tipo || '').toLowerCase();
  const tabela = (tipoRaw === 'auto' || tipoRaw === 'automóvel') ? 'Auto' : 'Imovel';
  const airtableToken = getEnv('AIRTABLE_TOKEN');

  if (!airtableToken) return { ok: false, erro: 'AIRTABLE_TOKEN não configurada.' };

  const consulta = async (faixa) => {
    const filtro = `AND((${valor}*${1 + faixa})>{Credito},(${valor}*${1 - faixa})<{Credito})`;
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_DEFAULT}/${encodeURIComponent(tabela)}?filterByFormula=${encodeURIComponent(filtro)}&sort%5B0%5D%5Bfield%5D=Credito&sort%5B0%5D%5Bdirection%5D=asc&maxRecords=12`;

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${airtableToken}` }
    });
    const jsonResp = await resp.json().catch(() => ({}));
    return (jsonResp.records || []).map(r => r.fields);
  };

  let planos = await consulta(0.10);
  if (!planos.length) planos = await consulta(0.20);

  return { ok: true, planos };
}

async function handleUpdateLead(body) {
  const uuid = String(body.uuid || '');
  const kommoLeadId = body.kommo_lead_id;
  const status = body.status;

  // SOMENTE move para Transmissão no Kommo CRM e grava no Google Sheets se o usuário preencheu a Proposta Completa!
  if (kommoLeadId && status === 'proposta enviada' && body.proposta) {
    try {
      await kommo.atualizarLeadKommo(kommoLeadId, body.valor);
    } catch (e) {
      console.error('Erro ao mover lead para Transmissão no Kommo:', e);
    }

    try {
      const p = body.proposta || {};
      await gravarGoogleSheets({
        nome: body.nome || p.nome_completo,
        email: body.email,
        cpf: p.cpf,
        telefone: body.telefone,
        tipo: body.tipo,
        valor: body.valor,
        plano: body.plano,
        descricao: body.descricao,
        credito: body.credito,
        parcela: body.parcela,
        pontos: body.pontos,
        dispositivo: body.dispositivo,
        url: body.url,
        nome_completo: p.nome_completo,
        nascimento: p.nascimento,
        rg: p.rg,
        orgao: p.orgao,
        naturalidade: p.naturalidade,
        nome_mae: p.nome_mae,
        endereco: p.endereco,
        cep: p.cep,
        uuid: uuid,
        status: 'proposta enviada',
        kommo_lead_id: kommoLeadId
      });
    } catch (eSheets) {
      console.error('Erro ao gravar proposta no Google Sheets:', eSheets);
    }
  }

  return { ok: true };
}

// Export da Vercel Serverless Handler
module.exports = async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, erro: 'Método não permitido.' });
  }

  try {
    let body = req.body || {};
    if (Buffer.isBuffer(body)) {
      try { body = body.toString('utf8'); } catch (e) {}
    }
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) {}
    }
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) {}
    }
    const action = body.action;

    let responseData = { ok: false, erro: 'Ação inválida.' };

    if (action === 'send_otp') {
      responseData = await handleSendOtp(body);
    } else if (action === 'verify_otp') {
      responseData = await handleVerifyOtp(body);
    } else if (action === 'get_plans') {
      responseData = await handleGetPlans(body);
    } else if (action === 'update_lead') {
      responseData = await handleUpdateLead(body);
    }

    return res.status(200).json(responseData);
  } catch (err) {
    console.error('Erro no servidor /api/simulador:', err);
    return res.status(500).json({ ok: false, erro: 'Erro interno no servidor.' });
  }
};
