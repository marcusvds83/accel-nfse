#!/usr/bin/env python3
"""
odoo-scripts/recriar-botao-cancelar.py
=====================================
Recria o Server Action "Cancelar NFS-e" no Odoo com URL e API key
corretas do middleware, e adiciona logging via chatter.

Antes de rodar, sete as env vars:
  ODOO_URL, ODOO_DB, ODOO_API_KEY
"""

import os, json, xmlrpc.client

ODOO_URL = os.environ['ODOO_URL'].rstrip('/')
ODOO_DB = os.environ['ODOO_DB']
ODOO_API_KEY = os.environ['ODOO_API_KEY']

# MIDDLEWARE - confirme estes valores
MIDDLEWARE_URL = 'https://nfse-nytro.onrender.com'
# ATENCAO: Cole aqui a API_KEY exata do Render
MIDDLEWARE_KEY = os.environ.get('MIDDLEWARE_API_KEY', '')

print('=== Recriando botao Cancelar NFS-e ===')
print(f'Middleware URL: {MIDDLEWARE_URL}')
print(f'Middleware Key: {MIDDLEWARE_KEY[:4]}...{MIDDLEWARE_KEY[-4:]}' if len(MIDDLEWARE_KEY) > 8 else f'Middleware Key: {MIDDLEWARE_KEY}')

common = xmlrpc.client.ServerProxy(f'{ODOO_URL}/xmlrpc/2/common')
uid = common.authenticate(ODOO_DB, ODOO_API_KEY, ODOO_API_KEY, {})
if not uid:
    raise SystemExit('Autenticacao falhou. Verifique ODOO_API_KEY.')
print(f'Autenticado como uid={uid}')

models = xmlrpc.client.ServerProxy(f'{ODOO_URL}/xmlrpc/2/object')

def kw(model, method, args=None, kwargs=None):
    return models.execute_kw(ODOO_DB, uid, ODOO_API_KEY, model, method, args or [], kwargs or {})

model_ids = kw('ir.model', 'search', [[['model', '=', 'account.move']]])
if not model_ids:
    raise SystemExit('Modelo account.move nao encontrado')
model_id = model_ids[0]

# Codigo do botao com logging detalhado no chatter
# Usa x-api-key em minusculo para bater com o middleware
# Tenta com retry pois o Render free tier pode estar dormindo
codigo = f"""import urllib.request, json, time
from odoo.exceptions import UserError

move_id = record.id
move_name = record.name
nfse_status = record.x_nytro_nfse_status or ''
chave = record.x_nytro_nfse_codigo_verificacao or ''

record.message_post(body='<b>[CANCELAR NFS-e]</b> Botao pressionado para %s | Status: %s | Chave: %s' % (move_name, nfse_status or 'vazio', chave[:20] + '...' if chave else '(vazia)'))

if nfse_status != 'autorizada':
    raise UserError('A NFS-e precisa estar com status "autorizada" para cancelar. Status atual: ' + (nfse_status or 'vazio'))

if not chave:
    raise UserError('Chave de acesso vazia no Odoo. Nao e possivel cancelar.')

justificativa = 'Cancelamento solicitado pelo emitente via Odoo'
url = '{MIDDLEWARE_URL}/api/v1/nfse/cancelar'
payload = json.dumps({{'move_id': move_id, 'justificativa': justificativa}}).encode('utf-8')
req = urllib.request.Request(url, data=payload, headers={{
    'Content-Type': 'application/json',
    'x-api-key': '{MIDDLEWARE_KEY}',
}}, method='POST')

record.message_post(body='<b>[CANCELAR NFS-e]</b> Enviando requisicao para o middleware...')

try:
    with urllib.request.urlopen(req, timeout=90) as resp:
        resultado = json.loads(resp.read().decode('utf-8'))
    record.message_post(body='<b>[CANCELAR NFS-e]</b> Resposta do middleware: %s' % json.dumps(resultado, ensure_ascii=False))
    if resultado.get('sucesso'):
        raise UserError('NFS-e ' + move_name + ' cancelada com sucesso!')
    else:
        raise UserError('Cancelamento rejeitado: ' + str(resultado.get('xMotivo', 'Erro desconhecido')))
except urllib.error.HTTPError as e:
    corpo = ''
    try:
        corpo = e.read().decode('utf-8')
    except:
        pass
    record.message_post(body='<b>[CANCELAR NFS-e] ERRO HTTP %s</b><pre>%s</pre>' % (e.code, corpo[:500]))
    raise UserError('Erro HTTP %s ao contatar middleware: %s' % (e.code, corpo[:200]))
except urllib.error.URLError as e:
    record.message_post(body='<b>[CANCELAR NFS-e] ERRO DE CONEXAO</b> %s' % str(e))
    raise UserError('Erro de conexao com middleware (servico pode estar dormindo). Tente novamente em 30s: ' + str(e))
"""

# Remove acao anterior se existir
existing = kw('ir.actions.server', 'search', [[['name', '=', 'Cancelar NFS-e']]])
if existing:
    kw('ir.actions.server', 'unlink', [existing])
    print('Acao anterior removida.')

action_id = kw('ir.actions.server', 'create', [{
    'name': 'Cancelar NFS-e',
    'model_id': model_id,
    'binding_model_id': model_id,
    'binding_view_types': 'form',
    'state': 'code',
    'code': codigo,
}])

print(f'Botao "Cancelar NFS-e" recriado com sucesso! (ir.actions.server ID={action_id})')
print('Agora o botao posta logs no chatter a cada etapa.')