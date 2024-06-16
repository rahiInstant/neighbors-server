const express = require("express");
const app = express();
require("dotenv").config();
const cors = require("cors");
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@neighbors.bfwh7rr.mongodb.net/?retryWrites=true&w=majority&appName=neighbors`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    // Database and collection
    const neighborDB = client.db("neighborDB");
    const userCollection = neighborDB.collection("user");
    const postCollection = neighborDB.collection("post");
    const commentCollection = neighborDB.collection("comment");
    const feedCollection = neighborDB.collection("feed");

    // common parts

    const isUserExist = async (userMail) => {
      const filter = { email: userMail };
      const result = await userCollection.findOne(filter);
      return result;
    };

    // user related API
    app.post("/user-registration", async (req, res) => {
      const data = req.body;
      const query = { email: req?.body?.email };
      // const isUserExist = await userCollection.findOne(query);
      if (await isUserExist(data?.email)) {
        return res.send({ acknowledged: false, insertedId: null });
      }
      const result = await userCollection.insertOne(data);
      res.send(result);
    });

    app.get("/check-admin", async (req, res) => {
      const email = req.query?.email;
      const check = await isUserExist(email);
      res.send({ isAdmin: check?.isAdmin });
    });

    // user post related API
    app.post("/user-post", async (req, res) => {
      const data = req.body;
      const result = await postCollection.insertOne(data);
      // console.log(result)
      // console.log(data)
      res.send(result);
    });
    app.get("/show-post", async (req, res) => {
      const userMail = req.query?.email;
      const query = { email: userMail };
      const result = await postCollection
        .find(query)
        .sort({ postingTime: -1 })
        .toArray();
      // console.log(result);
      res.send(result);
    });

    app.get("/all-post", async (req, res) => {
      const result = await postCollection.find().toArray();
      res.send(result);
    });

    app.delete("/delete-post", async (req, res) => {
      const postId = req.query?.postId;
      const query = { _id: new ObjectId(postId) };
      const result = await postCollection.deleteOne(query);
      res.send(result);
    });

    app.get("/post-detail", async (req, res) => {
      const postId = req.query?.postId;
      const query = { _id: new ObjectId(postId) };
      // const result = await postCollection.findOne(query);
      const result = await postCollection
        .aggregate([
          {
            $match: { _id: new ObjectId(postId) },
          },
          {
            $lookup: {
              from: "user",
              let: { userEmail: "$email" },
              pipeline: [
                {
                  $match: {
                    $expr: { $eq: ["$email", "$$userEmail"] },
                  },
                },
                {
                  $project: {
                    _id: 0,
                    name: 1,
                    email: 1,
                  },
                },
              ],
              as: "userInfo",
            },
          },
          {
            $unwind: "$userInfo",
          },
          {
            $replaceRoot: {
              newRoot: {
                $mergeObjects: ["$userInfo", "$$ROOT"],
              },
            },
          },
          {
            $project: {
              userInfo: 0,
            },
          },
        ])
        .toArray();
      // console.log(result)
      res.send(result[0]);
    });

    app.post("/user-comment", async (req, res) => {
      const data = req.body;
      const result = await commentCollection.insertOne(data);
      res.send(result);
    });
    app.get("/all-user-comment", async (req, res) => {
      const postId = req.query.postId;
      const result = await commentCollection
        .aggregate([
          {
            $match: { postId: postId },
          },
          {
            $lookup: {
              from: "user",
              let: { userEmail: "$email" },
              pipeline: [
                {
                  $match: {
                    $expr: { $eq: ["$email", "$$userEmail"] },
                  },
                },
                {
                  $project: {
                    _id: 0,
                    name: 1,
                    email: 1,
                  },
                },
              ],
              as: "userInfo",
            },
          },
          {
            $unwind: "$userInfo",
          },
          {
            $replaceRoot: {
              newRoot: {
                $mergeObjects: ["$userInfo", "$$ROOT"],
              },
            },
          },
          {
            $project: {
              userInfo: 0,
            },
          },
        ])
        .toArray();
      res.send(result);
    });

    app.patch("/update-reaction", async (req, res) => {
      const postId = req.query.postId;
      const data = req.body;
      const query = { _id: new ObjectId(postId) };
      updateDoc = {
        $inc: {
          ...data,
        },
      };
      const result = await postCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    app.post("/comment-feedback", async (req, res) => {
      const data = req.body;
      const result =await feedCollection.insertOne(data);
      res.send(result);
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // do something.
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Share your thought.");
});

app.listen(port, () => {
  console.log(`server running at port: ${port}`);
});
