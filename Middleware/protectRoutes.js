const jwt = require("jsonwebtoken");
const log = require("../utils/logger");

function authenticate(req, res, next) {
    
    const authHeader =
        req.headers.authorization;

    if (!authHeader)
        return res.sendStatus(401);

    const token =
        authHeader.split(" ")[1];

    try {

        const decoded =
            jwt.verify(
                token,
                process.env.JWT_SECRET
            );

        req.user = decoded;

        next();

    } catch {

        return res.sendStatus(403);
    }
};

module.exports = { authenticate }