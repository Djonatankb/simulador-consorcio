# Backend Serverless Vercel (`/api/simulador`) — Guia Completo de Variáveis de Ambiente

Documentação de todas as **Variáveis de Ambiente (Environment Variables)** configuráveis no painel da Vercel em **Project Settings ➔ Environment Variables**.

---

## 🔑 Lista Completa de Variáveis de Ambiente

| Key (Nome da Variável) | Default / Recomendado | Descrição |
| :--- | :--- | :--- |
| **`KOMMO_TOKEN`** | *(Seu Token Kommo)* | Bearer Token de Longa Duração do Kommo CRM |
| **`KOMMO_SUBDOMAIN`** | `gustavoligavitoriacom` | Subdomínio da conta no Kommo |
| **`KOMMO_SEM_CONTATO`** | `109917515` | ID da fase "Sem Contato" (fase inicial) |
| **`KOMMO_STAGE_TRANSMISSAO`** | `109093615` | ID da etapa "Transmissão" no Kommo |
| **`KOMMO_PIPELINE_ID`** | `14131759` | ID do Funil no Kommo |
| **`SMS_API_KEY`** | *(Chave Comtele)* | Chave de API da Comtele para envio de SMS real |
| **`SKIP_SMS_VERIFICATION`** | `false` (Prod) / `true` (Testes) | `true` aceita qualquer código; `false` exige SMS real |
| **`AIRTABLE_TOKEN`** | *(Token Airtable)* | Token Personal Access do Airtable |
| **`GOOGLE_SPREADSHEET_ID`** | `1FeMY6hfwSix7YR_ndVVxFjcqt2D4JaPWtd38Qc4wP3k` | ID da planilha Google Sheets |

---

## ⚡ Dicas de Configuração na Vercel:

1. **Para Modo Produção (Com SMS Real)**:
   - `SKIP_SMS_VERIFICATION` = `false` (ou remova a variável)
   - `SMS_API_KEY` = *(sua chave Comtele)*

2. **Para Modo Testes/Staging (Sem gastar créditos de SMS)**:
   - `SKIP_SMS_VERIFICATION` = `true`
