const asyncHandler = require('express-async-handler');
const  { pool , prisma } = require('../database/db');
const log = require("../utils/logger");


//@desc Get all users
//@req has no body
//@res needs all Users out.
const getUsers = asyncHandler(async (req, res) => {
    log("Usercontrol.js","getUsers","Request received");

    const id = req.params.id;
    const result = await prisma.User.findUnique({
        where: {
            userid: id
        },
        select: {
            username: true
        }
    });
    const name = result.rows[0].username
    res.status(400).send(`Hello ${name}!`);
    log("Usercontrol.js","getUsers","Request resolved");

});

module.exports = { getUsers };