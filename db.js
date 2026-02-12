const mysql = require("mysql2");
const db = mysql.createPool({
    host: "localhost",
    user: "root",
    password: "",
    database: "mesenger"
});
module.exports = db;
