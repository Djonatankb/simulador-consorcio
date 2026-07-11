# Troca do Landbot pelo widget próprio — passo a passo (WordPress/Elementor)

> Executar somente após aprovação da direção.
> Página alvo: `https://livelo.ligavitoria.com.br/simulador-consorcio/` (Elementor, página ID **1979**).
> O Landbot está num **widget HTML** do Elementor (elemento `34748ec`) — é só trocar o conteúdo desse campo.

---

## 1. Pré-checagem (5 min, antes de mexer no WordPress)

1. Abra `https://simulador-consorcio-amber.vercel.app/` no navegador (aba anônima).
2. Faça uma simulação completa com **seu telefone real**: o SMS deve chegar via Comtele (se aparecer o código na tela, o backend está em modo teste — pare e verifique a `SMS_API_KEY` nas Propriedades do Script).
3. Confira se o lead apareceu na planilha **"Leads do Consórcio - Landbot"**, aba **Leads**.
4. Só siga se os 3 itens acima estiverem OK.

## 2. Trocar o embed no Elementor

1. Entre no painel: `https://livelo.ligavitoria.com.br/wp-admin/`.
2. Menu **Páginas** → localize a página do simulador (`/simulador-consorcio/`) → **Editar com Elementor**.
3. Clique no bloco do chat (é um **widget HTML**; o código atual começa com `<html>` e carrega `cdn.landbot.io/landbot-3/landbot-3.0.0.js`).
4. **Antes de apagar, copie o código atual e guarde** (backup para rollback — cópia também na seção 5 abaixo).
5. Apague tudo e cole o novo snippet:

```html
<iframe
  src="https://simulador-consorcio-amber.vercel.app/"
  title="Simulador de Consórcio — Liga Vitória"
  style="width:100%; height:100dvh; min-height:600px; border:0; display:block;"
  loading="eager"></iframe>
```

6. Clique em **Atualizar** (botão verde) para publicar.

**Ajuste fino (se precisar):**
- Se sobrar **barra de rolagem dupla** ou o chat ficar cortado, troque `height:100dvh` por `height:calc(100vh - 90px)` (ajuste os 90px para a altura do cabeçalho do site).
- Se aparecer **margem branca** nas laterais, selecione o container pai no Elementor → aba **Avançado** → zere o *padding* e defina largura como *Full Width*.

## 3. Testes pós-troca (10 min)

1. Abra a página `livelo.ligavitoria.com.br/simulador-consorcio/` em **aba anônima** (para não pegar cache).
2. Teste no **celular** e no **desktop**.
3. Faça **uma simulação completa de verdade**: nome → telefone → SMS → código → valor → escolha do plano → proposta.
4. Confira o lead na planilha (linha nova com nome, telefone verificado, valor e plano).
5. Abra o console do navegador (F12) e veja se não há erros em vermelho.

## 4. Depois de estabilizado (aguardar alguns dias)

- Acompanhe os leads por 3–7 dias comparando com o volume histórico do Landbot.
- Estando tudo normal: **cancelar a assinatura do Landbot** (economia ≈ €1.320/ano).
- Não excluir a conta/fluxo do Landbot antes de exportar o histórico de conversas, se for útil.

## 5. Rollback (se algo der errado)

Volte ao mesmo widget HTML no Elementor e cole o snippet antigo do Landbot:

```html
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, height=device-height, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Liga Digital - Triagem</title>
  </head>
  <body>
    <script SameSite="None; Secure" src="https://cdn.landbot.io/landbot-3/landbot-3.0.0.js"></script>
    <script>
      var myLandbot = new Landbot.Fullpage({
        configUrl: 'https://storage.googleapis.com/landbot.online/v3/H-2555475-XB9TJTWXZRN01RO9/index.json',
      });
    </script>
  </body>
</html>
```

Clique em **Atualizar** e a página volta ao Landbot imediatamente (o rollback só funciona enquanto a assinatura do Landbot estiver ativa — mais um motivo para só cancelar depois da estabilização).

---

**Notas técnicas** (verificadas em 11/07/2026):
- A URL de produção é `simulador-consorcio-amber.vercel.app` (a URL sem sufixo, `simulador-consorcio.vercel.app`, pertence a outra conta — não usar).
- A Vercel não envia `X-Frame-Options` nem CSP `frame-ancestors`, então o iframe funciona sem configuração extra.
- O widget publicado já aponta para o backend real do Apps Script (`BACKEND_URL` preenchida).
