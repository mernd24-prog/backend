const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { returnValidation } = require('../src/modules/validation');
const { AppError } = require('../src/shared/errors/app-error');

function fixture() {
  const routes = [];
  const calls = [];
  const authenticate = (req, res, next) => next();
  const router = {};
  for (const method of ['get', 'post']) router[method] = (route, ...handlers) => { routes.push({ method, route, handlers }); return router; };
  const module = { exports: {} };
  const dependencies = {
    express: { Router: () => router },
    '../../../shared/middleware/authenticate': { authenticate },
    '../../../shared/middleware/access': { allowPermissions: permission => Object.assign(() => {}, { permission }) },
    '../../../shared/middleware/catch-errors': { catchErrors: handler => handler },
    '../../../shared/http/reply': { okResponse: data => ({ success: true, data }) },
    '../../../shared/auth/current-user': { getCurrentUser: req => req.actor },
    '../services/return.service': { ReturnService: { getBuyerReturnById: async (id, actor) => {
      calls.push({ id, actor }); return { _id: id, buyerId: actor.userId };
    } } },
    '../../validation': { returnValidation },
    '../../../shared/errors/app-error': { AppError },
    '../../../shared/logger/audit.service': { auditService: {} },
  };
  const source = fs.readFileSync(path.resolve(__dirname, '../src/modules/returns/routes/return.routes.js'), 'utf8');
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`); return dependencies[name];
  }, module, module.exports);
  return { routes, calls, authenticate };
}

test('customer inspection detail uses authentication and buyer-ownership service without admin module permission', async () => {
  const ctx = fixture();
  const route = ctx.routes.find(route => route.method === 'get' && route.route === '/my-returns/:returnId');
  assert.ok(route);
  assert.equal(route.handlers[0], ctx.authenticate);
  assert.ok(route.handlers.every(handler => !handler.permission));
  let response;
  await route.handlers.at(-1)({ params: { returnId: 'return-a' }, actor: { userId: 'buyer-a', role: 'customer' } }, { json: value => { response = value; } });
  assert.equal(ctx.calls[0].id, 'return-a');
  assert.equal(ctx.calls[0].actor.userId, 'buyer-a');
  assert.equal(response.data.buyerId, 'buyer-a');
});

test('admin return detail and courier-arrival mutation retain their original permission boundaries', () => {
  const ctx = fixture();
  const admin = ctx.routes.find(route => route.method === 'get' && route.route === '/:returnId');
  const visit = ctx.routes.find(route => route.method === 'post' && route.route === '/:returnId/collection-visit');
  assert.ok(admin.handlers.some(handler => handler.permission === 'returns:view'));
  assert.ok(visit.handlers.some(handler => handler.permission === 'returns:update'));
  assert.equal(visit.handlers[0], ctx.authenticate);
});
