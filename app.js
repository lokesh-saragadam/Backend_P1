// All system modules
const express = require("express");
const cors = require("cors");
const morgan = require('morgan');
const process = require('process');
//functions and other imports
const log = require("./utils/logger");
const {reset_Database} = require('./init/createTables')
const {router} = require('./Routes/router');
const { pool,prisma } = require('./database/db')
const { platform } = require('os');
const app = express()

// 1. Add Morgan at the very top. 
// This will automatically log every incoming request and its 
// status code (e.g., "GET /api/users 404")

app.use(morgan('dev'));


//others

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(cors({
    origin: [
        "http://localhost:5173",
        "chrome-extension://ekefiaamkelcgkfpmpohnbahldohakga"
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    // Crucial: You must allow the Authorization header here
    allowedHeaders: ['Content-Type', 'Authorization']
}));


//REST APIs
// using static and middleware.
app.use(express.static('./public'))
app.use(express.urlencoded({
    extended: true,
    limit: "10mb"
}));


//methods for adding users
app.use('/api', router);

// 2. Add a Global Error Handler at the very BOTTOM of your file.
// If ANY route throws an error, it gets caught here instead of crashing the server.
app.use((err, req, res, next) => {
    console.error("🔥 ERROR DETECTED 🔥");
    console.error(`Route: ${req.method} ${req.url}`);
    console.error(`Message: ${err.message}`);
    console.error(err.stack); // Shows the exact file and line number!
    
    res.status(500).json({
        success: false,
        message: "Something went wrong on the server",
        error: err.message
    });
});

//Database Handling.
async function datastart(){
    // await reset_Database(); //empty the database.
    // await prisma.User.delete({
    //     where:{
    //         userid:3,
    //     },
    // });
    // const alldata = await prisma.UserHandle.findMany({
    //     select:{
    //         handleid:true,
    //         userid:true,
    //         handle:true,
    //     }
    // });
    // console.log(alldata);

    // await createTables();   //create all the tables if they dont exist.
} 
// altertables();
datastart(); 
 
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>{
    console.log('app is listening on port', PORT)
})