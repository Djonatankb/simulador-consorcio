# Documentação do Sistema — Variáveis de Ambiente & Kommo CRM

Este documento registra o mapeamento das variáveis de ambiente do projeto e os identificadores das fases de funil do Kommo CRM.

---

## 📋 Variáveis de Ambiente do Kommo CRM

| Variável | Valor Padrão / ID | Descrição |
| :--- | :--- | :--- |
| `KOMMO_TOKEN` | *(Configurado via .env)* | Token de Acesso (Bearer Token de Longa Duração) do Kommo CRM. |
| `KOMMO_SUBDOMAIN` | `gustavoligavitoriacom` | Subdomínio da conta do Kommo CRM. |
| **`KOMMO_SEM_CONTATO`** | `109917515` | **ID da fase inicial ("Sem Contato")** no funil do Kommo CRM. *(Anteriormente KOMMO_VALIDAR_OPORTUNIDADE=109093611)* |
| `KOMMO_STAGE_TRANSMISSAO` | `109093615` | ID da etapa "Transmissão" no funil do Kommo CRM. |
| `KOMMO_PIPELINE_ID` | `14131759` | ID do Funil de Vendas do Kommo CRM. |

---

## 🔄 Histórico de Alterações

- **05/08/2026**:
  - Alterada a variável de ambiente `KOMMO_VALIDAR_OPORTUNIDADE` (ID `109093611`) para **`KOMMO_SEM_CONTATO`** (ID **`109917515`**).
  - Atualizado o módulo [lib/kommo.js](file:///c:/Users/Liga%20Vit%C3%B3ria%20MKT/Desktop/Simulador%20Cons%C3%B3rcio/simulador-consorcio/lib/kommo.js) para utilizar a nova variável `KOMMO_SEM_CONTATO` e o valor default `109917515`.
