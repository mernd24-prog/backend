# Backend Deployment

Use this file when you are already inside the `backend` folder. For the full VPS setup from PuTTY, use `../DEPLOYMENT_HANDBOOK.md`.

## Required Runtime

- Node.js 20+
- MongoDB
- PostgreSQL
- Redis
- PM2 for VPS deployment
- Nginx reverse proxy to port `4000`

## Environment

```bash
cp .env.example .env
nano .env
chmod 600 .env
```

Generate secrets:

```bash
openssl rand -base64 48
```

Use different values for `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`.

## First Production Deploy

```bash
npm ci --omit=dev
npm run check
npm run db:migrate
npm run db:seed:rbac
npm run db:create-super-admin
npm run db:repair:rbac-role-assignments
PM2_LOG_DIR=/var/www/logs pm2 start ecosystem.config.js --env production
pm2 save
curl http://127.0.0.1:4000/health
```

## Normal Backend Update

```bash
git pull --ff-only
npm ci --omit=dev
npm run check
npm run db:migrate
PM2_LOG_DIR=/var/www/logs pm2 restart ecommerce-backend
curl http://127.0.0.1:4000/health
```

Run this after RBAC/module/sidebar changes:

```bash
npm run db:seed:rbac
PM2_LOG_DIR=/var/www/logs pm2 restart ecommerce-backend
```

Run this after importing or seeding users outside the normal app flow:

```bash
npm run db:repair:rbac-role-assignments
PM2_LOG_DIR=/var/www/logs pm2 restart ecommerce-backend
```

## Docker

Production image:

```bash
docker build -t ecommerce-backend .
docker run --env-file .env -p 4000:4000 ecommerce-backend
```

Local development compose still uses the `development` Docker target:

```bash
docker compose up --build
```
