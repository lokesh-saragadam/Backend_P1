//middleware functions
function getUsers() {
    const data = fs.readFileSync(dataPath, 'utf-8')
    return JSON.parse(data)
}

async function log(message) {
    const timestamp = new Date().toISOString();

    await fs.promises.appendFile(
        "server.log",
        `[${timestamp}] ${message}\n`
    );
}

function saveUsers(usersArray) {
    fs.writeFileSync(dataPath, JSON.stringify({users : usersArray}, null, 2))
}



//Used  to post a user and userid.

async function post_users(name){
    try{
    // const result = await pool.query(`
    //     SELECT userid, name
    //     FROM users
    //     ORDER BY userid;
        // SELECT name, COUNT(*)
        // FROM users
        // GROUP BY name
        // HAVING COUNT(*) > 1;
        
    //     `);

    const result = await pool.query(
            `INSERT INTO users(name)
             VALUES($1)
             ON CONFLICT(name) DO NOTHING
             RETURNING *`,
            [name]
        );
    console.log(result.rows);
        // console.log(result.rows[0]);
    if(result.rows.length === 0){
        return -1;
    }
    console.log("User stored");
    return result.rows[0].userid;

    } catch (err) {
        console.log(err);
    }
}


//To use the JWT Authentication:
//@ Request:
const token = localStorage.getItem("token");

fetch("/api/profile", {
    headers: {
        Authorization: `Bearer ${token}`
    }
});

//@ Route:
app.get(
    "/api/profile",
    authenticate,
    async (req, res) => {

        res.json({
            userId: req.user.userId
        });

    }
);