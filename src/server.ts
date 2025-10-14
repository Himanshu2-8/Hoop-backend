import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import prisma from "./prisma.js";
import { createJWT } from "./middleware.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", async(req, res) => {
  res.send("Hoop Backend running 🏀");
});

app.post("/signup",async(req,res)=>{
  const {name,email,password}=req.body;
  const existingUser=await prisma.user.findUnique({
    where:{email}
  })
  
  if(existingUser){
    return res.status(400).json({message:"User already exists"})
  }
  
  try{
    const user=await prisma.user.create({
      data:{
        name,
        email,
        passwordHash:password
      }
    })
    const token = createJWT(user);
    return res.status(201).json({message:"User created successfully", token})
  }catch(e){
    return res.status(500).json({message:"Internal server error"})
  }
})

app.post("/signin", async (req, res) => {
  const { email, password } = req.body;
  const existingUser = await prisma.user.findUnique({
    where: { email }
  });

  if (!existingUser || existingUser.passwordHash !== password) {
    return res.status(400).json({ message: "Incorrect Credentials" });
  }

  const token = createJWT(existingUser);
  return res.status(200).json({ message: "User signed in successfully", token });
})

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});