const express = require("express");
const app = express();
require("dotenv").config();
const cors = require("cors");
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const {
  MongoClient,
  ServerApiVersion,
  ObjectId,
  serialize,
} = require("mongodb");
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

    // aggregate Obj

    // Database and collection
    const neighborDB = client.db("neighborDB");
    const userCollection = neighborDB.collection("user");
    const postCollection = neighborDB.collection("post");
    const commentCollection = neighborDB.collection("comment");
    const feedCollection = neighborDB.collection("feed");
    const tagCollection = neighborDB.collection("tag");
    const announcementCollection = neighborDB.collection("announce");

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
      // data["postingTime"] = new Date();
      const result = await postCollection.insertOne(data);
      res.send(result);
    });
    app.get("/show-post", async (req, res) => {
      const userMail = req.query?.email;
      const query = { email: userMail };
      const result = await postCollection
        .find(query)
        .sort({ postingTime: -1 })
        .toArray();
      res.send(result);
    });

    app.get("/all-user", async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    app.get("/all-post", async (req, res) => {
      const data = req.query;
      const searchText = data.search;
      const isSort = data.sort == "true";
      const aggregateArr = [
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
          $lookup: {
            from: "comment",
            let: { postId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $eq: [{ $toObjectId: "$postId" }, "$$postId"],
                  },
                },
              },
              {
                $group: {
                  _id: "$postId",
                  commentCount: { $sum: 1 },
                },
              },
              {
                $project: {
                  _id: 0,
                  commentCount: 1,
                },
              },
            ],
            as: "comments",
          },
        },
        {
          $addFields: {
            commentCount: {
              $ifNull: [{ $arrayElemAt: ["$comments.commentCount", 0] }, 0],
            },
          },
        },
        {
          $project: {
            userInfo: 0,
            comments: 0,
          },
        },
      ];

      if (searchText !== "") {
        aggregateArr.unshift({
          $match: { tags: { $regex: searchText, $options: "i" } },
        });
      }

      if (isSort) {
        aggregateArr.splice(5, 0, {
          $addFields: {
            voteDifference: { $subtract: ["$upVote", "$downVote"] },
          },
        });
      }
      const result = await postCollection
        .aggregate(aggregateArr)
        .sort(isSort ? { voteDifference: -1 } : { postingTime: -1 })
        .toArray();
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
            $lookup: {
              from: "feed",
              let: { commentId: "$_id" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $eq: [{ $toObjectId: "$commentId" }, "$$commentId"],
                    },
                  },
                },
              ],
              as: "reportInfo",
            },
          },
          {
            $addFields: {
              isExistInReport: {
                $cond: {
                  if: { $gt: [{ $size: "$reportInfo" }, 0] },
                  then: true,
                  else: false,
                },
              },
            },
          },
          {
            $project: {
              userInfo: 0,
              reportInfo: 0,
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
      const result = await feedCollection.insertOne(data);
      res.send(result);
    });

    app.get("/check-report", async (req, res) => {
      const commentId = req.query.commentId;
      const query = { commentId: commentId };
      const result = await feedCollection.findOne(query);
      console.log(result);
      res.send({ isExist: result ? true : false });
    });

    app.get("/estimated-data", async (req, res) => {
      const users = await userCollection.estimatedDocumentCount();
      const post = await postCollection.estimatedDocumentCount();
      const comment = await commentCollection.estimatedDocumentCount();
      // console.log(users, post, comment);
      res.send([
        { key: "users", value: users },
        { key: "post", value: post },
        { key: "comment", value: comment },
      ]);
    });

    app.post("/add-tag", async (req, res) => {
      const data = req.body;
      const result = await tagCollection.insertOne(data);
      res.send(result);
    });

    app.get("/all-tag", async (req, res) => {
      const result = await tagCollection.find().toArray();
      // console.log(result);
      res.send(result);
    });
    app.patch("/make-admin", async (req, res) => {
      const email = req.body.email;
      const query = { email: email };
      const updateDoc = {
        $set: {
          isAdmin: true,
        },
      };

      const result = await userCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    app.get("/all-feed", async (req, res) => {
      const result = await feedCollection
        .aggregate([
          {
            $lookup: {
              from: "user",
              let: { commenterEmail: "$emailComment" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $eq: ["$email", "$$commenterEmail"],
                    },
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
              as: "commenterInfo",
            },
          },
          {
            $unwind: "$commenterInfo",
          },
          {
            $lookup: {
              from: "comment",
              let: { commentId: "$commentId" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $eq: ["$_id", { $toObjectId: "$$commentId" }],
                    },
                  },
                },
                {
                  $project: {
                    _id: 0,
                    comment: 1,
                  },
                },
              ],
              as: "commentText",
            },
          },
          {
            $unwind: "$commentText",
          },
          {
            $addFields: {
              commenterInfo: {
                $mergeObjects: ["$commenterInfo", "$commentText"],
              },
            },
          },
          {
            $lookup: {
              from: "user",
              let: { authorEmail: "$emailBlock" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $eq: ["$email", "$$authorEmail"],
                    },
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
              as: "authorInfo",
            },
          },
          {
            $unwind: "$authorInfo",
          },
          {
            $lookup: {
              from: "post",
              let: { postId: "$postId" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $eq: ["$_id", { $toObjectId: "$$postId" }],
                    },
                  },
                },
                {
                  $project: {
                    _id: 0,
                  },
                },
              ],
              as: "postInfo",
            },
          },
          {
            $unwind: "$postInfo",
          },
          {
            $addFields: {
              authorInfo: {
                $mergeObjects: ["$authorInfo", "$postInfo"],
              },
            },
          },
          {
            $project: {
              emailBlock: 0,
              emailComment: 0,
              postInfo: 0,
              commentText: 0,
            },
          },
        ])
        .toArray();
      res.send(result);
    });

    app.post("/store-announcement", async (req, res) => {
      const data = req.body;
      const result = await announcementCollection.insertOne(data);
      res.send(result);
    });

    app.get("/get-announcement", async (req, res) => {
      const result = await announcementCollection.find().toArray();
      res.send(result);
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // do something
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Share your thought.");
});

app.listen(port, () => {
  console.log(`server running at port: ${port}`);
});
