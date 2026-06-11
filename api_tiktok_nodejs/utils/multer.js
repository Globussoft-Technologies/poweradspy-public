import { S3Client } from "@aws-sdk/client-s3";
import multer from "multer";
import multerS3 from "multer-s3";
import config from "config";

const s3 = new S3Client({
  region: config.get("region"),
  credentials: {
    accessKeyId: config.get("accessKeyId"),
    secretAccessKey: config.get("secretAccessKey"),
  },
});

const upload = multer({
  storage: multerS3({
    s3,
    bucket: config.get("bucketName"),
    metadata: function (req, file, cb) {
      cb(null, { fieldName: file.fieldname });
    },
    key: function (req, file, cb) {
      cb(null, `${Date.now().toString()}_${file.originalname}`);
    },
  }),
});

export default upload;
