const express = require('express')
const path = require('path')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const app = express()
app.use(express.json())

let db

const dbPath = path.join(__dirname, 'twitterClone.db')

const startDbServer = async () => {
  db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  })
}

startDbServer()

app.get('/', async (req, res) => {
  res.send(await db.all(`select * from reply`))
})

app.post('/register/', async (req, res) => {
  const {username, password, name, gender} = req.body
  const user = await db.get(`select * from user where username = '${username}'`)
  if (user !== undefined) {
    res.status(400)
    res.send('User already exists')
  } else if (password.length < 6) {
    res.status(400)
    res.send('Password is too short')
  } else if (password.length >= 6) {
    const user_id =
      (await db.get(`select * from user order by user_id desc`)).user_id + 1
    const hashed_password = await bcrypt.hash(password, 12)
    await db.run(
      `insert into user values (${user_id}, '${name}', '${username}', '${hashed_password}', '${gender}')`,
    )
    res.status(200)
    res.send('User created successfully')
  }
})

app.post('/login/', async (req, res) => {
  const {username, password} = req.body
  const user = await db.get(`select * from user where username = '${username}'`)
  if (user === undefined) {
    res.status(400)
    res.send('Invalid user')
  } else if (await bcrypt.compare(password, user.password)) {
    const payLoad = {username: username}
    const jwtToken = jwt.sign(payLoad, 'my_key')
    res.send({
      jwtToken: jwtToken,
    })
  } else {
    res.status(400)
    res.send('Invalid password')
  }
})

const authenticate = async (req, res, next) => {
  if (req.headers.authorization !== undefined) {
    const awtToken = req.headers.authorization.split(' ')[1]
    jwt.verify(awtToken, 'my_key', (err, payLoad) => {
      if (err) {
        res.status(401)
        res.send('Invalid JWT Token')
      } else {
        req.username = payLoad.username
        next()
      }
    })
  } else {
    res.status(401)
    res.send('Invalid JWT Token')
  }
}

app.get('/user/tweets/feed/', authenticate, async (req, res) => {
  const user_id = (
    await db.get(`select * from user where username = '${req.username}'`)
  ).user_id
  const reqQuery = `select user.username, tweet.tweet, tweet.date_time as dateTime from follower inner join tweet on follower.following_user_id = tweet.user_id inner join user on user.user_id = tweet.user_id where follower.follower_user_id = ${user_id} order by tweet.date_time desc limit 4 `
  const result = await db.all(reqQuery)
  res.send(result)
})

app.get('/user/following/', authenticate, async (req, res) => {
  const userId = (
    await db.get(`select * from user where username = '${req.username}'`)
  ).user_id

  const reqQuery = `select user.name from user inner join follower on
  user.user_id = follower.following_user_id 
  where follower.follower_user_id = ${userId}`

  const result = await db.all(reqQuery)
  res.send(result)
})

app.get('/user/followers/', authenticate, async (req, res) => {
  const userId = (
    await db.get(`select * from user where username = '${req.username}'`)
  ).user_id

  const reqQuery = `select user.name from user inner join follower on
  user.user_id = follower.follower_user_id 
  where follower.following_user_id = ${userId}`

  const result = await db.all(reqQuery)
  res.send(result)
})

const checkUser = async (req, res, next) => {
  const userId = (
    await db.get(`select * from user where username = '${req.username}'`)
  ).user_id
  const {tweetId} = req.params
  const reqQuery = `select * from tweet where tweet_id = ${tweetId}`
  const tweetedUserId = (await db.get(reqQuery)).user_id
  const following = await db.get(
    `select * from follower where follower_user_id = ${userId} and following_user_id = ${tweetedUserId}`,
  )
  if (following === undefined) {
    res.status(401)
    res.send('Invalid Request')
  } else {
    next()
  }
}

app.get('/tweets/:tweetId/', authenticate, checkUser, async (req, res) => {
  const {tweetId} = req.params
  const queryRequired = `select tweet.tweet, count(distinct like.like_id) as likes, count(distinct reply.reply_id) as replies, tweet.date_time as dateTime from 
    tweet inner join reply 
    on 
    tweet.tweet_id = reply.tweet_id inner join like
    on
    reply.tweet_id = like.tweet_id 
    where tweet.tweet_id = ${tweetId} group by tweet.tweet_id`
  qResult = await db.get(queryRequired)
  res.send(qResult)
})

app.get(
  '/tweets/:tweetId/likes/',
  authenticate,
  checkUser,
  async (req, res) => {
    const {tweetId} = req.params
    const queryRequired = `select user.username from user inner join like on
  like.user_id = user.user_id where tweet_id = ${tweetId}`
    let qResult = await db.all(queryRequired)
    let resArr = []
    qResult.forEach(obj => {
      resArr.push(obj.username)
    })
    res.send({
      likes: resArr,
    })
  },
)

app.get(
  '/tweets/:tweetId/replies/',
  authenticate,
  checkUser,
  async (req, res) => {
    const {tweetId} = req.params
    const queryToRequest = `select name, reply from user inner join reply on user.user_id = reply.user_id where tweet_id = ${tweetId}`
    const queryResult = await db.all(queryToRequest)
    res.send({
      replies: queryResult,
    })
  },
)

app.get('/user/tweets/', authenticate, async (req, res) => {
  const userId = (
    await db.get(`select * from user where username = '${req.username}'`)
  ).user_id

  const queryToRequest = `select tweet.tweet, count(distinct like.like_id) as likes, count (distinct reply.reply_id) as replies, tweet.date_time as dateTime 
  from tweet left join reply 
  on 
  tweet.tweet_id = reply.tweet_id
  left join like 
  on 
  tweet.tweet_id = like.tweet_id 
  where tweet.user_id = ${userId} group by tweet.tweet`
  const queryResult = await db.all(queryToRequest)
  res.send(queryResult)
})

app.post('/user/tweets/', authenticate, async (req, res) => {
  const tweetId =
    (await db.get(`select * from tweet order by tweet_id desc`)).tweet_id + 1
  const {tweet} = req.body
  const userId = (
    await db.get(`select * from user where username = '${req.username}'`)
  ).user_id
  const queryToRequest = `insert into tweet values(${tweetId}, '${tweet}', ${userId}, DateTime('now'))`
  const queryResult = await db.run(queryToRequest)
  console.log(queryResult)
  res.send('Created a Tweet')
})

app.delete('/tweets/:tweetId/', authenticate, async (req, res) => {
  const {tweetId} = req.params
  const userId = (
    await db.get(`select * from user where username = '${req.username}'`)
  ).user_id

  const userTweets = await db.all(
    `select * from tweet where user_id = ${userId}`,
  )

  const userTweetIds = []

  userTweets.forEach(tweet => {
    userTweetIds.push(tweet.tweet_id)
  })

  if (userTweetIds.includes(parseInt(tweetId))) {
    await db.run(`delete from tweet where tweet_id = ${tweetId}`)
    res.send('Tweet Removed')
  } else {
    res.status(401)
    res.send('Invalid Request')
  }
})

app.listen(3000, () => {
  console.log('Server Started..')
})

module.exports = app
