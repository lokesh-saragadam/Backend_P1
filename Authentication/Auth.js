const express = require('express');
const { pool , prisma } = require('../database/db')
const bcrypt = require('bcrypt');
const asyncHandler = require('express-async-handler');
const jwt = require("jsonwebtoken");
const dotenv = require("dotenv").config();
const log = require("../utils/logger");

const registerUser = asyncHandler(async (req,res) => {
    req_username = req.body.username;
    password = req.body.password;
    req_email = req.body.email;
    log("Auth.js","registerUser","Request received");
    //checking if the username,email already exists
    const result = await prisma.User.findUnique({ where: { username: req_username,email : req_email } })
    if(!result){
        const saltrounds = 10
        const hashedPassword = await bcrypt.hash(password, saltrounds);
        // await pool.query(
        //     'INSERT INTO users (username, password, email) VALUES ($1, $2, $3)',
        //     [username, hashedPassword, email]
        // );
        const user = await prisma.User.create({
            data: {
                username:req_username,
                password: hashedPassword,
                email:req_email
            }
        });
        const token = jwt.sign(
                {
                    userId: user.userid,
                    email: user.email
                },
                process.env.JWT_SECRET,
                {
                    expiresIn: "1h"
                }
        );
        log("Auth.js","registerUser","User registered received",user.userid);
        return res.status(201).json({"message": `Registration Successful`,userId:user.userid,token});
    }
    else{
        return res.status(400).json({"message": `Username or Email id already exists`});
    }
})

const loginUser = asyncHandler(async (req,res)=>{
    const email = req.body.email;
    const password = req.body.password;
    log("Auth.js","loginUser","Request received");
    const result = await prisma.User.findUnique({ where: {email : email}})
    if(!result){
        return res.status(400).json({"message": `Email does not exist`});
    }
    else{
        const user = result;
        const isMatch = await bcrypt.compare(password, user.password);
        if(!isMatch){
            return res.status(400).json({"message": `Invalid Password `});
        }
        else{
            const token = jwt.sign(
                {
                    userId: user.userid,
                    email: user.email
                },
                process.env.JWT_SECRET,
                {
                    expiresIn: "1h"
                }
            );
            log("Auth.js","loginUser","User logged in ",user.userid);
            res.json({ userId:user.userid,token });
        }
    }
});

module.exports = { registerUser , loginUser };