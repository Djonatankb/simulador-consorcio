# Simulador de Consórcio — Liga Vitória

Widget de simulação de consórcio (chat) que substitui o Landbot (≈ €1.320/ano). Front-end estático
servido pela Vercel e embutido, via iframe, na página `livelo.ligavitoria.com.br/simulador-consorcio/`
(WordPress). Backend gratuito em Google Apps Script; leads no Google Sheets; planos no Airtable; SMS na Comtele.

## Arquivos

| Arquivo | O que é |
|---|---|
| `simulador-consorcio.html` | Widget completo (HTML+CSS+JS num arquivo). `BACKEND_URL` vazio = modo demonstração (SMS mostrado na tela). Fonte: Montserrat (Google Fonts). Fallback de OTP: após 60s sem validar, oferece reenviar SMS ou corrigir o número. |
| `backend-apps-script.gs` | **Fonte única** do backend (Apps Script Web App). Roteia `send_otp / verify_otp / get_plans / update_lead`. |
| `deploy/` | Pasta ligada ao projeto Vercel (`.vercel/`). `deploy/index.html` é a cópia publicada do widget. |
| `dados/planos-unificado.csv` · `dados/planos.json` | Planos do Airtable normalizados — backup e fonte do modo demonstração. |
| `dados-logos/` | Logos de marca (SVG/PNG). Fontes comerciais e binários pesados ficam **fora do repo** (ver `.gitignore`). |
| `docs/troca-widget-wordpress.md` | Passo a passo para substituir o Landbot pelo widget no WordPress/Elementor (aguardando aprovação da direção). |

## Arquitetura

- **SMS: Comtele (API nova).** `enviarSMS()` faz `POST https://api.comtele.com.br/messages/sms/send`,
  header **`x-api-key`**, corpo `{ receivers: ['55'+DDD+número], message, route }`. Valida a resposta por
  **`hasError`** (falha → erro logado e mensagem genérica ao usuário). Rota de envio da conta = **`17`**.
- **Planos: Airtable** (base `appAXa666ayzjld9S`, tabelas `Imovel`/`Auto`), filtro ±10 % (fallback ±20 %),
  com cache de 5 min por (tabela, valor). Alternativa `getPlansDaPlanilha()` (aba "Planos") deixada como referência.
- **Leads: Google Sheets** "Leads do Consórcio - Landbot", aba "Leads". A linha nasce no `verify_otp`
  (nome + telefone verificado) e é atualizada no `update_lead` (valor, plano, proposta). Layout de colunas: ver
  a constante `COL` no `.gs`. **LGPD:** a coluna 13 guarda a proposta (CPF/RG) — restrinja o compartilhamento
  da planilha e defina prazo de retenção. *(Futuro: migrar leads para o Salesforce.)*

## Segredos — Propriedades do Script (nunca no código)

Apps Script → ⚙ Configurações do projeto → **Propriedades do script**:

| Propriedade | Valor |
|---|---|
| `SMS_API_KEY` | `x-api-key` da Comtele (portal developers.comtele.com.br → "Sua Chave de API") |
| `SMS_ROUTE` | rota de envio (opcional; padrão `17`) |
| `AIRTABLE_TOKEN` | Personal Access Token do Airtable (escopo `data.records:read`) |

Enquanto `SMS_API_KEY` estiver vazia, o backend roda em **modo teste** (devolve o código na resposta, sem custo de SMS).

## Deploy

**Backend (Apps Script) — via clasp, preservando a URL do `BACKEND_URL`:**

```bash
cp backend-apps-script.gs scratch/gas/Código.js         # sincroniza a fonte única
cd scratch/gas
clasp push                                              # envia o código
clasp update-deployment <ID_DA_IMPLANTAÇÃO>             # EDITA a implantação existente (NÃO "Nova implantação")
```

> ⚠️ "Nova implantação" gera outra URL `/exec` e quebra o widget. Sempre use `update-deployment`.
> `scratch/` está no `.gitignore`; `backend-apps-script.gs` é a fonte da verdade.

**Front-end (Vercel):** `cp simulador-consorcio.html deploy/index.html && cd deploy && npx vercel deploy --prod --yes`.

**Go-live (quando o Landbot for descontinuado):** na página WordPress `/simulador-consorcio/`, trocar o
bloco `<script>` do Landbot por um `<iframe>` em tela cheia apontando para a URL da Vercel. Reversível; não mexe em DNS.

## Segurança (endurecimento aplicado)

- OTP: limite de **5 tentativas de verificação** por código (anti-brute-force) + limite de 3 envios/10 min; código derivado de UUID. Após 60s sem validação, o widget oferece reenvio ou correção do número, dentro do mesmo limite de envios.
- Erros internos **nunca** vão ao cliente (mensagem genérica + `Logger`).
- Escrita na planilha passa por `sane()` (anti-injeção de fórmula/CSV).
- Validação de entrada (telefone, valor, ação, uuid) em toda borda do roteador.
- Nenhum segredo no código-fonte (tudo em Propriedades do Script). Repositório **privado**.

## Custo variável

Só o SMS: **~R$ 0,08–0,15 por lead verificado**. Contra ~R$ 8.400/ano do Landbot, o ponto de equilíbrio
é de dezenas de milhares de leads/ano — a troca se paga desde o primeiro mês.
