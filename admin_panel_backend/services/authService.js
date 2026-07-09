const dotenv = require("dotenv");
const jwt = require("jsonwebtoken");
dotenv.config();
const authenticateJWT = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        console.log(authHeader, "authHeader");

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                message: "Authorization token missing",
            });
        }

        const token = authHeader.split(" ")[1];



        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        //   validation 
        if (!decoded.user_name) {
            return res.status(401).json({
                message: "Invalid access token",
            });
        }

        req.user = decoded;

        next();
    } catch (error) {

        return res.status(401).json({
            message: "Unauthorized",
        });
    }
};

module.exports = { authenticateJWT };