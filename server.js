// server.js
import express from "express";
import mongoose from "mongoose";
import session from "express-session";
import MongoStore from "connect-mongo";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname } from "path";
import postRoutes from "./routes/posts.js";
import Post from "./models/Post.js";
import User from "./models/Users.js";
import bcrypt from "bcrypt";
import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";
import striptags from "striptags";

const window = new JSDOM("").window;
const DOMPurify = createDOMPurify(window);

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


mongoose.connect(process.env.MONGO_URI).then(() => console.log("MongoDB Connected"))
  .catch(err => console.error(err));


app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));
app.set("view engine", "ejs");


app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI })
}));

app.use(express.json()); 
app.use("/api/posts", postRoutes); 


function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.redirect("/login");
  }
  next();
}


app.get("/register", (req, res) => {
  res.render("register");
});

app.post("/register", async (req, res) => {
  const { username, email, password } = req.body;

  try {
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.send("User already exists. Try logging in.");
    }

    const newUser = new User({ username, email, password });
    await newUser.save();

    req.session.userId = newUser._id;
    res.redirect("/");
  } catch (err) {
    console.error("Register error:", err);
    res.send("Registration failed.");
  }
});


app.get("/login", (req, res) => {
  res.render("login");
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.send("User not found");

    const isMatch = await user.matchPassword(password);
    if (!isMatch) return res.send("Invalid credentials");

    req.session.userId = user._id; 
    res.redirect("/");
  } catch (err) {
    console.error("Login error:", err);
    res.send("Login failed");
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});



app.get("/", requireLogin, async (req, res) => {
  try {
    const sort = req.query.sort || "recent";

    let sortOption = { createdAt: -1 }; 
    if (sort === "liked") sortOption = { likes: -1 };
    else if (sort === "oldest") sortOption = { createdAt: 1 };

    const posts = await Post.find()
      .sort(sortOption)
      .populate("comments.author")
      .populate("author");

    posts.forEach(post => {
      post.preview = striptags(post.content).substring(0, 200);
    });

    res.render("home", { posts, session: req.session, sort });
  } catch (err) {
    console.error("Failed to load posts:", err);
    res.render("home", { posts: [], session: req.session, sort: "recent" });
  }
});

app.get("/post/:id", requireLogin, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate("author")
      .populate("comments.author");

    if (!post) return res.status(404).send("Post not found");

    res.render("post", { post, session: req.session });
  } catch (err) {
    console.error("Error loading post:", err);
    res.status(500).send("Server error");
  }
});

app.get('/profile', requireLogin, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    const posts = await Post.find({ author: user._id }).sort({ createdAt: -1 });

    
    const postsWithPreview = posts.map(post => ({
      ...post.toObject(), 
      plainPreview: striptags(post.content).substring(0, 100)
    }));

    res.render('profile', { user, posts: postsWithPreview });
  } catch (err) {
    console.error("Profile fetch error:", err);
    res.status(500).send("Server Error");
  }
});

app.get("/edit/:id", requireLogin, async (req, res) => {
  const post = await Post.findById(req.params.id);

  if (!post || post.author.toString() !== req.session.userId) {
    return res.status(403).send("Unauthorized or not found");
  }
  res.render("edit", { post, session: req.session });
});


app.post("/edit/:id", requireLogin, async (req, res) => {
  const { title, content } = req.body;
  const cleanContent = DOMPurify.sanitize(content);
  const post = await Post.findById(req.params.id);
  if (post.author.toString() !== req.session.userId) {
    return res.status(403).send("Unauthorized");
  }
  post.title = title;
  post.content = content;
  await post.save();
  res.redirect("/profile");
});

app.post("/delete/:id", requireLogin, async (req, res) => {
  const post = await Post.findById(req.params.id);
  if (!post || post.author.toString() !== req.session.userId) {
    return res.status(403).send("Unauthorized");
  }
  await Post.findByIdAndDelete(req.params.id);
  res.redirect("/profile");
});


app.get("/create", requireLogin, (req, res) => {
  res.render("create", { session: req.session });
});

app.post("/create", requireLogin, async (req, res) => {

  const { title, content } = req.body;
  const cleanContent = DOMPurify.sanitize(content);

  try {
    const post = new Post({
      title,
      content, 
      author: req.session.userId
    });

    await post.save();
    res.redirect("/");
  } catch (err) {
    console.error("Error saving post:", err);
    res.send("Failed to create post.");
  }
});

app.post("/like/:id", requireLogin, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);

    if (!post) return res.status(404).send("Post not found");

    if (!post.likedBy.includes(req.session.userId)) {
      post.likes += 1;
      post.likedBy.push(req.session.userId);
      await post.save();
    }

    res.redirect(`/post/${req.params.id}`);
  } catch (err) {
    console.error("Like error:", err);
    res.status(500).send("Server error");
  }
});


app.post("/comment/:id", requireLogin, async (req, res) => {
  try {
    const { text } = req.body;
    const post = await Post.findById(req.params.id);

    post.comments.push({
      text,
      author: req.session.userId
    });

    await post.save();
    res.redirect(`/post/${req.params.id}`);
  } catch (err) {
    console.error("Comment error:", err);
    res.status(500).send("Comment failed");
  }
});






app.use((req, res) => {
  res.status(404).send("Page not found");
});



app.listen(3000, () => {
    console.log("Server is running on http://localhost:3000");
});

