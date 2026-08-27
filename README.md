# NFS-e Nytro LTDA

Middleware de emissao propria de NFS-e para a **Nytro LTDA** — Curitiba/PR.

## Arquitetura

```
Odoo (fatura com x_nytro_nfse_status = "pendente")
    | XML-RPC (polling)
Middleware Node.js (Render)
    | certificado A1
Firebase (cofre)
    | XML ABRASF v2 assinado
Prefeitura de Curitiba (webservice NFS-e)
    | autorizada
Middleware gera DANFSE PDF
    | anexa XML + PDF + atualiza status
Odoo (chatter da fatura)
```

## Diferencas em relacao a AJL (NF-e)

| Aspecto | AJL (NF-e) | Nytro (NFS-e) |
|---|---|---|
| Destinatario | SEFAZ (estadual) | Prefeitura (municipal) |
| Padrao XML | NF-e 4.00 | ABRASF v2 |
| Imposto | ICMS | ISS (LC 116) |
| Certificado | Disco Render + env | Firebase (cofre) |
| Documento | DANFE | DANFSE |

## Estrutura do Projeto

```
nfse-nytro/
  server.js                  Servidor Express
  config.js                  Configuracoes (env vars)
  package.json
  .env.example               Template de variaveis de ambiente
  services/
    firebase-cert.js         Cofre do certificado A1 no Firebase
    pfx-openssl.js           Fallback OpenSSL para PFX
    nfse-xml.js              Gerador de XML NFS-e (ABRASF v2) [TODO]
    nfse-signer.js           Assinatura digital XMLDSig [TODO]
    nfse-client.js           Cliente SOAP prefeitura [TODO]
    nfse-cancelamento.js     Cancelamento de NFS-e [TODO]
    nfse-odoo-emit.js        Polling + integracao Odoo
  routes/
    nfse-cert.js             Rotas de certificado
    nfse.js                  Rotas de emissao/cancelamento
  odoo-scripts/
    criar-botao-emitir-nfse.py   Cria botao "Emitir NFS-e"
    criar-botao-cancelar-nfse.py Cria botao "Cancelar NFS-e"
```

## Campos Customizados no Odoo

### account.move (Faturas)

| Campo | Tipo | Default | Descricao |
|---|---|---|---|
| `x_nytro_nfse_status` | Selection | `vazio` | vazio, pendente, processando, autorizada, cancelada, erro |
| `x_nytro_nfse_numero` | Char | — | Numero da NFS-e |
| `x_nytro_nfse_codigo_verificacao` | Char | — | Codigo de verificacao |
| `x_nytro_nfse_chave` | Char | — | Chave/codigo unico |
| `x_nytro_nfse_protocolo` | Char | — | Protocolo de autorizacao |
| `x_nytro_nfse_xml` | Text | — | XML da NFS-e (backup) |
| `x_nytro_nfse_erro` | Text | — | Mensagem de erro |
| `x_nytro_nfse_dh_emissao` | Datetime | — | Data/hora da emissao |

### res.company (Empresa)

| Campo | Tipo | Default | Descricao |
|---|---|---|---|
| `x_nytro_nfse_serie` | Char | `1` | Serie da NFS-e |
| `x_nytro_nfse_ultimo_numero` | Integer | `0` | Ultimo numero emitido |
| `x_nytro_nfse_inscricao_municipal` | Char | — | Inscricao Municipal |
| `x_nytro_nfse_aliquota_padrao` | Float | `5.0` | Aliquota ISS padrao (%) |
| `x_nytro_nfse_optante_simples` | Boolean | `True` | Optante Simples Nacional |
| `x_nytro_nfse_cnae` | Char | — | CNAE principal |
| `x_nytro_nfse_item_lista_servico` | Char | — | Item LC 116 padrao |
| `x_nytro_nfse_regime_especial` | Selection | `vazio` | vazio, microempresa, empresa_pequeno_porte |
| `x_nytro_nfse_incentivador_cultural` | Boolean | `False` | Incentivador cultural |

### product.product (Servicos)

| Campo | Tipo | Descricao |
|---|---|---|
| `x_nytro_item_lista` | Char | Item LC 116 (ex: 01.07) |
| `x_nytro_cnae` | Char | CNAE do servico |
| `x_nytro_codigo_tributacao` | Char | Codigo tributacao municipal |
| `x_nytro_aliquota_iss` | Float | Aliquota ISS especifica (%) |
| `x_nytro_iss_retido` | Boolean | ISS retido na fonte? |
| `x_nytro_descricao_nfse` | Text | Descricao para a NFS-e |

## Deploy no Render

1. Conecte o GitHub ao Render
2. Build Command: `npm install`
3. Start Command: `npm start`
4. Configure as Environment Variables (copiar do .env.example)
5. O servidor inicia o polling automaticamente

## Firebase Setup

1. Crie um projeto no [Firebase Console](https://console.firebase.google.com/)
2. Va em **Project Settings > Service Accounts**
3. Clique em **Generate New Private Key**
4. Copie `project_id`, `client_email` e `private_key` para as env vars
5. O Firestore sera criado automaticamente no primeiro acesso

## Enviar Certificado

```bash
curl -X POST https://nfse-nytro.onrender.com/api/v1/nfse/certificado \
  -H "x-api-key: SUA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"pfxBase64":"'$(base64 -w0 Nytro.pfx)'","senha":"SUA_SENHA"}'
```

## Gerar API Key no Odoo

1. Acesse o Odoo da Nytro
2. Clique no avatar do usuario (canto superior direito) > **Preferencias**
3. Va em **Conteudo > Chaves de API** (ou "API Keys")
4. Clique em **Gerar nova chave** e copie o valor
5. Cole nas Environment Variables do Render como `ODOO_API_KEY`

> A API Key substitui login e senha. Ela expira se o usuario alterar sua senha.

## Criar Botoes no Odoo

```bash
# Botao Emitir NFS-e
ODOO_URL=https://nytro.odoo.com ODOO_DB=nytro \
  ODOO_API_KEY=sua-api-key-aqui \
  python3 odoo-scripts/criar-botao-emitir-nfse.py

# Botao Cancelar NFS-e
ODOO_URL=https://nytro.odoo.com ODOO_DB=nytro \
  ODOO_API_KEY=sua-api-key-aqui \
  MIDDLEWARE_URL=https://nfse-nytro.onrender.com \
  MIDDLEWARE_API_KEY=sua-chave \
  python3 odoo-scripts/criar-botao-cancelar-nfse.py
```

## Proximos Passos

- [ ] Configurar Firebase e testar cofre
- [ ] Confirmar URLs dos webservices de Curitiba
- [ ] Implementar gerador XML ABRASF v2 (nfse-xml.js)
- [ ] Implementar assinatura XMLDSig (nfse-signer.js)
- [ ] Implementar cliente SOAP prefeitura (nfse-client.js)
- [ ] Implementar cancelamento (nfse-cancelamento.js)
- [ ] Implementar DANFSE PDF (danfse-pdf.js)
