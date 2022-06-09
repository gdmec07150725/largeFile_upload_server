const http = require("http");
const path = require("path");
const fse = require("fs-extra");
const multiparty = require("multiparty"); // 使用multiparty处理前端传过来的formData
const server = http.createServer();

// 提取后缀名
const extractExt = (filename) =>
  filename.slice(filename.lastIndexOf("."), filename.length);

// 大文件储存目录
const UPLOAD_DIR = path.resolve(__dirname, "target");

const resolvePost = (req) =>
  new Promise((resolve) => {
    let chunk = "";
    req.on("data", (data) => {
      chunk += data;
    });
    req.on("end", () => {
      resolve(JSON.parse(chunk));
    });
  });

// 返回已上传的所有切片名
const createUploadedList = async (fileHash) =>
  fse.existsSync(path.resolve(UPLOAD_DIR, "chunkDir_" + fileHash))
    ? await fse.readdir(path.resolve(UPLOAD_DIR, "chunkDir_" + fileHash))
    : [];

// 写入文件流
const pipeStream = (path, writeStream) =>
  new Promise((resolve) => {
    const readStream = fse.createReadStream(path);
    readStream.on("end", () => {
      fse.unlinkSync(path);
      resolve();
    });
    readStream.pipe(writeStream);
  });

// 合并切片
const mergeFileChunk = async (filePath, fileHash, size) => {
  const chunkDir = path.resolve(UPLOAD_DIR, "chunkDir_" + fileHash);
  const chunkPaths = await fse.readdir(chunkDir);
  // 根据切片下标进行排序
  // 否则直接读取目录的获取的顺序会错乱
  chunkPaths.sort((a, b) => a.split("-")[1] - b.split("-")[1]);
  // 并发写入文件
  await Promise.all(
    chunkPaths.map((chunkPath, index) =>
      pipeStream(
        path.resolve(chunkDir, chunkPath),
        // 根据size在指定位置创建可写流
        fse.createWriteStream(filePath, { start: index * size })
      )
    )
  );
  // 合并后删除保存的切片目录
  fse.rmdirSync(chunkDir);
};

server.on("request", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    res.status = 200;
    res.end();
    return;
  }

  if (req.url === "/") {
    res.status = 200;
    res.end("node服务已启动");
  }

  if (req.url === "/verify") {
    const data = await resolvePost(req);
    const { fileHash, filename } = data;
    const ext = extractExt(filename);
    const filePath = path.resolve(UPLOAD_DIR, `${fileHash}${ext}`);
    if (fse.existsSync(filePath)) {
      res.end(
        JSON.stringify({
          shouldUpload: false,
        })
      );
    } else {
      res.end(
        JSON.stringify({
          shouldUpload: true,
          uploadedList: await createUploadedList(fileHash)
        })
      );
    }
  }

  if (req.url === "/merge") {
    const data = await resolvePost(req);
    console.log("data", data);
    const { filename, fileHash, size } = data;
    const ext = extractExt(filename);
    const filePath = path.resolve(UPLOAD_DIR, `${fileHash}${ext}`);
    await mergeFileChunk(filePath, fileHash, size);
    res.end(
      JSON.stringify({
        code: 0,
        message: "file merged success",
      })
    );
  }

  if (req.url === "/upload") {
    const multipart = new multiparty.Form();
    multipart.parse(req, async (err, fields, files) => {
      if (err) return;
      const [chunk] = files.chunk;
      const [hash] = fields.hash;
      const [fileHash] = fields.fileHash;
      const [filename] = fields.filename;
      // 创建临时文件夹用于临时存储chunk
      // 添加chunkDir前缀与文件名做区分
      const chunkDir = path.resolve(UPLOAD_DIR, "chunkDir_" + fileHash);

      if (!fse.existsSync(chunkDir)) {
        await fse.mkdirs(chunkDir);
      }

      // fs-extra的rename方法windows平台会有权限维妮塔
      await fse.move(chunk.path, `${chunkDir}/${hash}`);
      res.end("received file chunk");
    });
  }
});

server.listen(8081, () => console.log("listening port 8081"));
