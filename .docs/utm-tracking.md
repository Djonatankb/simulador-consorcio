# Rastreamento de Origem e UTMs no Simulador de Consórcio

Este documento detalha como funciona a captura dos parâmetros de rastreamento (`UTMs`, `gclid`, `fbclid`, etc.) no Simulador de Consórcio da Liga Vitória e como montar links para disparos de e-mail marketing e campanhas.

---

## 1. Parâmetros Suportados

O simulador captura automaticamente os seguintes **10 parâmetros** a partir da URL de acesso ou do iframe (com fallback em `sessionStorage`):

| Parâmetro | Finalidade | Exemplo de Preenchimento |
| :--- | :--- | :--- |
| **`utm_source`** | **Origem do tráfego** (Obrigatório em e-mails) | `email`, `rdstation`, `activecampaign` |
| **`utm_medium`** | **Meio de comunicação** (Obrigatório em e-mails) | `email_mkt`, `newsletter`, `automacao` |
| **`utm_campaign`** | **Nome da campanha** (Recomendado) | `consorcio_imovel_agosto`, `black_friday` |
| **`utm_term`** | **Público / Segmento** (Opcional) | `base_quente`, `leads_inativos` |
| **`utm_content`** | **Variação/Botão** (Opcional) | `botao_cta_topo`, `banner_meio` |
| **`utm_referrer`** | Origem secundária/Referrer | `google.com`, `instagram.com` |
| **`referrer`** | URL completa da página de referência | `https://livelo.ligavitoria.com.br/` |
| **`gclientid`** | Client ID do Google Analytics | `123456789.987654321` |
| **`gclid`** | Click ID automático do Google Ads | `Cj0KCQj...` |
| **`fbclid`** | Click ID automático do Meta Ads (FB/IG) | `IwAR2...` |

---

## 2. Como Montar Links para E-mail Marketing

Ao criar seus e-mails no provedor de envio (ActiveCampaign, RD Station, Mailchimp, etc.), adicione os parâmetros UTM no final do link do simulador.

### Exemplo Básico (Mínimo Recomendado):
```text
https://livelo.ligavitoria.com.br/simulador-consorcio/?utm_source=email&utm_medium=email_mkt&utm_campaign=consorcio_imovel_agosto
```

### Exemplo Completo (com variação do botão CTA):
```text
https://livelo.ligavitoria.com.br/simulador-consorcio/?utm_source=email&utm_medium=email_mkt&utm_campaign=consorcio_imovel_agosto&utm_content=botao_simular_agora
```

---

## 3. Como os Dados São Gravados no Kommo CRM

Quando o cliente digita e valida o telefone (via OTP), o sistema envia os dados capturados para o **Kommo CRM**:

1. **Tags Automáticas no Lead**:
   - `UTM: <utm_source>` (ex: `UTM: email`)
   - `Campanha: <utm_campaign>` (ex: `Campanha: consorcio_imovel_agosto`)
   - `Meio: <utm_medium>` (ex: `Meio: email_mkt`)

2. **Anotação Interna (Note) no Lead**:
   Uma anotação em destaque é criada no histórico do Lead no Kommo CRM:
   ```text
   📌 Origem & Rastreamento (UTMs):
   • UTM Source: email
   • UTM Medium: email_mkt
   • UTM Campaign: consorcio_imovel_agosto
   • UTM Content: botao_simular_agora
   • Referrer: https://livelo.ligavitoria.com.br/
   ```

3. **Botão de WhatsApp Flutuante**:
   Caso o cliente prefira clicar no botão flutuante do WhatsApp, o link é atualizado dinamicamente com a origem:
   `wa.me/15559924725?text=Gostaria%20de%20saber%20mais%20sobre%20o%20cons%C3%B3rcio%20(Origem%3A%20email%20%2F%20consorcio_imovel_agosto)`

---

## 4. Manutenção e Estrutura Técnica

- **Front-End**: `simulador-consorcio.html` & `deploy/index.html` (Funções `obterDadosRastreamento()` e `atualizarLinkWhatsapp()`).
- **Backend (Vercel Serverless)**: `api/simulador.js` & `lib/kommo.js` (`adicionarNotaUtmKommo()` e `montarTagsUtm()`).
- **Backend Legado (Google Apps Script)**: `backend-apps-script.gs` (`adicionarNotaUtmKommo()`).
