
import express from "express";
import Post from "../models/Post.js";

const router = express.Router();


router.post("/", async (req, res) => {
  try {
    const { title, content, author } = req.body;
    const post =new Post({
  title,
  content,
  author: req.session.userId 
});
    await post.save();
    res.status(201).json(post);
  } catch (err) {
    res.status(500).json({ message: "Failed to create post", error: err.message });
  }
});

router.put("/:id/like", async (req, res) => {
  try {
    const post = await Post.findByIdAndUpdate(
      req.params.id,
      { $inc: { likes: 1 } },
      { new: true }
    );
    res.json({ likes: post.likes });
  } catch (err) {
    res.status(500).json({ message: "Failed to like post" });
  }
});

router.get("/", async (req, res) => {
  try {
    const posts = await Post.find().sort({ createdAt: -1 });
    res.json(posts);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch posts" });
  }
});

export default router;
