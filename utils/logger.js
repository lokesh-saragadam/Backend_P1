const log = (file, func, message, data = null) => {
    console.log(
        `[${new Date().toISOString()}] [${file}] [${func}] ${message}`,
        data || ""
    );
};

module.exports = log;