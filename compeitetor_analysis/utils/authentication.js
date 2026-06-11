import config from "config";
import jwt from "jsonwebtoken";
import basicAuth from "basic-auth";

export function verifyToken(req,res,next){
    let token = req?.headers?.authorization;

    if(!token){
        return res.status(401).json({ message: "Unauthorized request!" });
    }
    token = token.split(" ")[1];

    jwt.verify(token, config.get("JWT_SECRET_KEY"), function (err, decoded) {
      if (err) {
        return res.status(401).json({ message: "Token expired!" });
      }

      req.user = decoded;
      next();
    });
}

// Swagger Authentication Middleware function 
export function SwaggerAuth(req, res, next) {
  const user = basicAuth(req);
  const username = config.get("USERNAME"); 
  const password = config.get("PASSWORD"); 
  if (!user || user.name !== username || user.pass !== password) {
    res.set("WWW-Authenticate", 'Basic realm="401"'); 
    return res.status(401).send("Authentication required.");
  }
  next();
}