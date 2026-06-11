import config from "config";
import jwt from "jsonwebtoken";
import Response from "./response.js";
import basicAuth from "basic-auth";
// Function to verify JWT
export function verifyToken(req, res, next) {
  // Token stored in cookies
  let token = req.headers["authorization"];

  //   Throw an error if token is not present
  if (!token) {
    return res.status(401).json({ message: "Unauthorized request!" });
  } else {
    token = token.split(" ")[1];
  }

  //   Verify the token
  jwt.verify(token, config.get("jwt_secret_key"), (err, decoded) => {
    // Throw an error if token is manipulated or expired
    if (err) {
      return res.status(401).json({ message: "Token expired!" });
    }

    // Store the decoded result in user variable for future purpose
    req.user = decoded;

    // Call the next middleware
    next();
  });
}

// Function to generate JWT
function generateToken(username) {
  // Return the signed token
  return jwt.sign({ username }, config.get("jwt_secret_key"), {
    expiresIn: "1h",
  });
}

// Function to create and save JWT in cookies
export async function createSendToken(req, res) {
  const { username, password } = req.body;
  const user =
    username === config.get("username") && password === config.get("password");

  if (!user) {
    return res.status(401).send("Username or password incorrect");
  }
  // Create a JWT token
  const token = generateToken(username);

  // Send success response
  res.send(Response.userSuccessResp("Logged in successfully.",`Bearer ${token}`));
}

// Swagger Authentication Middleware function 
export function SwaggerAuth(req, res, next) {
  const user = basicAuth(req);
  const username = config.get("username"); 
  const password = config.get("password"); 
  if (!user || user.name !== username || user.pass !== password) {
    res.set("WWW-Authenticate", 'Basic realm="401"'); 
    return res.status(401).send("Authentication required.");
  }
  next();
}