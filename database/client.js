require('dotenv').config({ quiet: true });
const { PrismaClient } = require('@prisma/client');
// Share one Prisma connection pool across controllers, services and scripts.
const prisma = new PrismaClient();
module.exports = { prisma };

