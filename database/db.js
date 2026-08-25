const { Pool } = require('pg')
const { PrismaClient } = require('@prisma/client');
const dotenv = require('dotenv').config();
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'Myapp1',
    password: process.env.POOL_PASS,
    port: 5432,
});

const prisma = new PrismaClient();
 
module.exports = { pool , prisma };
