/**
 * Módulo de Integração Direta com Kommo CRM (API v4)
 * Simulador de Consórcio — Liga Vitória
 */

const KOMMO_SUBDOMAIN_DEFAULT = 'gustavoligavitoriacom';
const KOMMO_STAGE_INICIAL_DEFAULT = 109917515;
const KOMMO_STAGE_TRANSMISSAO_DEFAULT = 109093615;
const KOMMO_PIPELINE_ID_DEFAULT = 14131759;

function getEnv(key, defaultValue = '') {
  return process.env[key] || defaultValue;
}

/**
 * Realiza chamadas HTTP autenticadas para a API v4 do Kommo CRM
 */
async function conectarKommo(endpoint, method, payload) {
  let token = getEnv('KOMMO_TOKEN');
  if (!token) return null;

  // Sanitização do Token (remove aspas, espaços e prefixos duplicados)
  token = token.replace(/^Bearer\s+/i, '').replace(/["']/g, '').trim();

  const subdominio = getEnv('KOMMO_SUBDOMAIN', KOMMO_SUBDOMAIN_DEFAULT);
  const url = `https://${subdominio}.kommo.com/api/v4/${endpoint.replace(/^\//, '')}`;

  try {
    const resp = await fetch(url, {
      method: method.toUpperCase(),
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: payload ? JSON.stringify(payload) : undefined
    });

    const data = await resp.json().catch(() => ({}));
    if (resp.ok) {
      return data;
    } else {
      console.error(`Kommo API Error (${resp.status}):`, JSON.stringify(data));
      return null;
    }
  } catch (err) {
    console.error('Kommo API Exception:', err);
    return null;
  }
}

/**
 * Atualiza os dados de um Contato já existente no Kommo CRM (Nome e E-mail)
 */
async function atualizarContatoKommo(contactId, nome, email, telefone) {
  if (!contactId) return null;

  const payload = [
    {
      id: Number(contactId),
      name: nome || 'Cliente',
      custom_fields_values: [
        { field_code: 'PHONE', values: [{ value: telefone }] },
        { field_code: 'EMAIL', values: [{ value: email }] }
      ]
    }
  ];

  return await conectarKommo('contacts', 'patch', payload);
}

let mapaCamposCache = null;

/**
 * Consulta a API v4 do Kommo CRM para obter os IDs dos campos customizados de Lead.
 */
async function obterMapaCamposKommo() {
  if (mapaCamposCache) return mapaCamposCache;

  try {
    const resp = await conectarKommo('leads/custom_fields', 'get');
    const campos = resp?._embedded?.custom_fields || [];
    const mapa = {};

    campos.forEach(c => {
      const nomeLower = String(c.name || '').trim().toLowerCase();
      const codeLower = String(c.code || '').trim().toLowerCase();
      
      mapa[nomeLower] = c.id;
      if (codeLower) mapa[codeLower] = c.id;
    });

    mapaCamposCache = mapa;
    return mapa;
  } catch (err) {
    console.error('Erro ao obter custom_fields do Kommo:', err);
    return {};
  }
}

/**
 * Monta o array custom_fields_values para os campos UTM do Lead
 */
async function montarCustomFieldsUtm(utms) {
  if (!utms || typeof utms !== 'object') return [];

  const mapaCampos = await obterMapaCamposKommo();
  const customFieldsValues = [];

  const nomesCampos = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term',
    'utm_content', 'utm_referrer', 'referrer', 'gclientid',
    'gclid', 'fbclid'
  ];

  nomesCampos.forEach(chave => {
    const valor = String(utms[chave] || '').trim();
    const fieldId = mapaCampos[chave];
    if (fieldId && valor) {
      customFieldsValues.push({
        field_id: Number(fieldId),
        values: [{ value: valor }]
      });
    }
  });

  return customFieldsValues;
}

/**
 * Monta as tags do Lead no Kommo CRM (apenas tags padrão)
 */
function montarTagsUtm() {
  return [
    { name: 'Simulador Consórcio' },
    { name: 'Mensagem Simulador' }
  ];
}

/**
 * Busca contato existente no Kommo por número de telefone.
 * Se o contato existir:
 * - Atualiza Nome e E-mail do contato (ZERO contatos duplicados).
 * - Se o contato já tiver um Lead vinculado, move o Lead existente para a fase 109917515 e o retorna.
 * - Se não tiver Lead vinculado, cria o Lead na fase 109917515 e vincula ao contato existente.
 * Se o contato não existir: cria Lead na fase 109917515 + Contato.
 */
async function buscarOuCriarLeadKommo(nome, email, telefone, tipo, utms = null) {
  const telLimpo = String(telefone || '').replace(/\D/g, '');
  if (!telLimpo) return null;

  const stageInicial = Number(getEnv('KOMMO_SEM_CONTATO', getEnv('KOMMO_STAGE_INICIAL', KOMMO_STAGE_INICIAL_DEFAULT)));
  const pipelineId = Number(getEnv('KOMMO_PIPELINE_ID', KOMMO_PIPELINE_ID_DEFAULT));
  const tagsLead = montarTagsUtm();
  const customUtms = await montarCustomFieldsUtm(utms);

  // 1. Busca se o contato já existe no Kommo pelo número de telefone
  try {
    const busca = await conectarKommo(`contacts?query=${encodeURIComponent(telLimpo)}&with=leads`, 'get');
    const contatoExistente = busca?._embedded?.contacts?.[0];

    if (contatoExistente && contatoExistente.id) {
      console.log(`Contato existente localizado no Kommo CRM (ID: ${contatoExistente.id}). Atualizando dados e movendo para a fase ${stageInicial}...`);

      // Atualiza E-mail e Nome do contato existente
      await atualizarContatoKommo(contatoExistente.id, nome, email, telLimpo);

      const leadExistenteId = contatoExistente?._embedded?.leads?.[0]?.id;

      if (leadExistenteId) {
        console.log(`Lead existente localizado (ID: ${leadExistenteId}). Movendo para a fase ${stageInicial}...`);
        
        // Move o Lead existente para a fase 109917515 com tags e custom fields
        const patchData = {
          id: Number(leadExistenteId),
          name: `Consórcio ${tipo || 'Imóvel'} - ${nome || 'Lead'}`,
          pipeline_id: pipelineId,
          status_id: stageInicial,
          _embedded: { tags: tagsLead }
        };
        if (customUtms.length > 0) patchData.custom_fields_values = customUtms;

        await conectarKommo('leads', 'patch', [patchData]);

        return leadExistenteId;
      } else {
        // Contato existe mas não tem Lead vinculado -> cria Lead na fase 109917515, vincula e adiciona tag
        const postData = {
          name: `Consórcio ${tipo || 'Imóvel'} - ${nome || 'Lead'}`,
          pipeline_id: pipelineId,
          status_id: stageInicial,
          _embedded: {
            contacts: [{ id: contatoExistente.id }],
            tags: tagsLead
          }
        };
        if (customUtms.length > 0) postData.custom_fields_values = customUtms;

        const respLead = await conectarKommo('leads', 'post', [postData]);
        const novoLeadId = respLead?._embedded?.leads?.[0]?.id || respLead?.[0]?.id;
        return novoLeadId;
      }
    }
  } catch (errBusca) {
    console.warn('Erro ao buscar lead/contato existente no Kommo:', errBusca);
  }

  // 2. Se não existir o contato, cria novo Lead na fase 109917515 e novo Contato
  return await criarLeadKommo(nome, email, telLimpo, tipo, stageInicial, utms);
}

/**
 * Cria Lead na fase inicial (109917515) no Kommo e vincula um novo Contato (Nome, E-mail, Telefone)
 */
async function criarLeadKommo(nome, email, telefone, tipo, stageId = KOMMO_STAGE_INICIAL_DEFAULT, utms = null) {
  const pipelineId = Number(getEnv('KOMMO_PIPELINE_ID', KOMMO_PIPELINE_ID_DEFAULT));
  const tagsLead = montarTagsUtm(utms);
  const customUtms = await montarCustomFieldsUtm(utms);

  // 1. Criar o Lead na fase inicial (109917515) com a tag Simulador Consórcio e custom fields de UTM
  const leadPayload = {
    name: `Consórcio ${tipo || 'Imóvel'} - ${nome || 'Lead'}`,
    pipeline_id: pipelineId,
    status_id: Number(stageId),
    _embedded: { tags: tagsLead }
  };
  if (customUtms.length > 0) leadPayload.custom_fields_values = customUtms;

  const payloadLead = [leadPayload];

  const respLead = await conectarKommo('leads', 'post', payloadLead);
  const leadId = respLead?._embedded?.leads?.[0]?.id || respLead?.[0]?.id;

  if (!leadId) {
    console.error('Falha ao criar Lead no Kommo CRM.');
    return null;
  }

  // 2. Criar e Vincular Contato ao Lead
  try {
    const payloadContato = [
      {
        name: nome || 'Cliente',
        custom_fields_values: [
          { field_code: 'PHONE', values: [{ value: telefone }] },
          { field_code: 'EMAIL', values: [{ value: email }] }
        ],
        _embedded: {
          leads: [{ id: leadId }]
        }
      }
    ];

    await conectarKommo('contacts', 'post', payloadContato);
  } catch (errContato) {
    console.error('Erro ao vincular contato no Kommo:', errContato);
  }

  if (utms) {
    await adicionarNotaUtmKommo(leadId, utms);
  }

  return leadId;
}

/**
 * Atualiza o Lead no Kommo CRM: move para Transmissão (109093615) e define valor (mantém o nome original do lead)
 */
async function atualizarLeadKommo(leadId, valor) {
  if (!leadId) return null;

  const stageId = Number(getEnv('KOMMO_STAGE_TRANSMISSAO', KOMMO_STAGE_TRANSMISSAO_DEFAULT));
  const pipelineId = Number(getEnv('KOMMO_PIPELINE_ID', KOMMO_PIPELINE_ID_DEFAULT));

  const payload = [
    {
      id: Number(leadId),
      price: Number(valor || 0),
      pipeline_id: pipelineId,
      status_id: stageId
    }
  ];

  return await conectarKommo('leads', 'patch', payload);
}

module.exports = {
  conectarKommo,
  buscarOuCriarLeadKommo,
  criarLeadKommo,
  atualizarContatoKommo,
  atualizarLeadKommo
};
