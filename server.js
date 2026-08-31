const express = require("express");
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");

const app = express();

app.use(express.json());

/* =====================================================
   GIAO DIỆN
===================================================== */

const PUBLIC_DIR = path.join(__dirname, "public");

app.use(express.static(PUBLIC_DIR));

app.get("/", (req, res) => {
  const indexFile = path.join(PUBLIC_DIR, "index.html");

  if (fs.existsSync(indexFile)) {
    return res.sendFile(indexFile);
  }

  return res.status(404).send("Không tìm thấy giao diện.");
});


/* =====================================================
   CẤU HÌNH CÔNG TY
===================================================== */

const COMPANY_LAT = 10.912145556678649;
const COMPANY_LNG = 106.79440737355388;

/* Bán kính được phép chấm công */
const ALLOWED_RADIUS = 300;


/* =====================================================
   DATABASE
===================================================== */

const DB_FILE = path.join(__dirname, "data.json");

function createDefaultDB() {
  return {
    users: [
      {
        name: "Lê Hiền",
        password: "1234",
        role: "employee"
      },
      {
        name: "Linh",
        password: "1234",
        role: "employee"
      },
      {
        name: "Admin",
        password: "admin123",
        role: "admin"
      }
    ],
    records: []
  };
}


/*
   Nếu chưa có data.json thì tạo mới
*/

if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(
    DB_FILE,
    JSON.stringify(createDefaultDB(), null, 2),
    "utf8"
  );
}


/*
   Đọc database
*/

function readDB() {
  try {
    const data = JSON.parse(
      fs.readFileSync(DB_FILE, "utf8")
    );

    if (!Array.isArray(data.users)) {
      data.users = [];
    }

    if (!Array.isArray(data.records)) {
      data.records = [];
    }

    /*
       Đảm bảo tài khoản Admin luôn tồn tại
    */

    const adminExists = data.users.some(
      user =>
        user.name === "Admin" &&
        user.role === "admin"
    );

    if (!adminExists) {
      data.users.push({
        name: "Admin",
        password: "admin123",
        role: "admin"
      });

      writeDB(data);
    }

    return data;

  } catch (error) {

    const newDB = createDefaultDB();

    writeDB(newDB);

    return newDB;
  }
}


/*
   Ghi database
*/

function writeDB(data) {
  fs.writeFileSync(
    DB_FILE,
    JSON.stringify(data, null, 2),
    "utf8"
  );
}


/* =====================================================
   SESSION
===================================================== */

const sessions = new Map();


/* =====================================================
   TÍNH KHOẢNG CÁCH GPS
===================================================== */

function distanceInMeters(
  lat1,
  lon1,
  lat2,
  lon2
) {

  const R = 6371000;

  const dLat =
    (lat2 - lat1) *
    Math.PI /
    180;

  const dLon =
    (lon2 - lon1) *
    Math.PI /
    180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;

  const c =
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    );

  return R * c;
}


/* =====================================================
   KIỂM TRA ĐĂNG NHẬP
===================================================== */

function auth(req, res, next) {

  const token =
    req.headers.authorization || "";

  const session =
    sessions.get(token);

  if (!session) {
    return res.status(401).json({
      error: "Chưa đăng nhập."
    });
  }

  req.user = session;

  next();
}


/* =====================================================
   KIỂM TRA ADMIN
===================================================== */

function admin(req, res, next) {

  if (req.user.role !== "admin") {
    return res.status(403).json({
      error: "Không có quyền quản trị."
    });
  }

  next();
}


/* =====================================================
   ĐĂNG NHẬP
===================================================== */

app.post("/api/login", (req, res) => {

  const db = readDB();

  const name =
    String(req.body.name || "").trim();

  const password =
    String(req.body.password || "");

  const user =
    db.users.find(
      x =>
        x.name === name &&
        x.password === password
    );

  if (!user) {
    return res.status(401).json({
      error:
        "Sai tài khoản hoặc mật khẩu."
    });
  }


  const token =
    Math.random()
      .toString(36)
      .slice(2) +
    Date.now().toString(36);


  sessions.set(token, {
    name: user.name,
    role: user.role
  });


  return res.json({
    ok: true,
    token,
    name: user.name,
    role: user.role
  });
});


/* =====================================================
   KIỂM TRA TÀI KHOẢN
===================================================== */

app.get("/api/me", auth, (req, res) => {

  res.json({
    name: req.user.name,
    role: req.user.role
  });

});


/* =====================================================
   CHẤM CÔNG VÀO
===================================================== */

app.post("/api/checkin", auth, (req, res) => {

  if (req.user.role === "admin") {
    return res.status(403).json({
      error:
        "Admin không chấm công bằng tài khoản quản trị."
    });
  }


  const latitude =
    Number(req.body.latitude);

  const longitude =
    Number(req.body.longitude);


  /*
     Kiểm tra GPS
  */

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {

    return res.status(400).json({
      error:
        "Không lấy được vị trí. Hãy bật GPS/vị trí rồi thử lại."
    });
  }


  /*
     Kiểm tra tọa độ hợp lệ
  */

  if (
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {

    return res.status(400).json({
      error:
        "Tọa độ GPS không hợp lệ."
    });
  }


  /*
     Tính khoảng cách
  */

  const distance =
    distanceInMeters(
      latitude,
      longitude,
      COMPANY_LAT,
      COMPANY_LNG
    );


  /*
     Không cho chấm ngoài công ty
  */

  if (distance > ALLOWED_RADIUS) {

    return res.status(403).json({
      error:
        `Bạn đang cách công ty khoảng ${Math.round(distance)} mét. Không thể chấm công ngoài phạm vi ${ALLOWED_RADIUS} mét.`
    });
  }


  const db = readDB();

  const now = new Date();


  /*
     Ngày Việt Nam
  */

  const date =
    now.toLocaleDateString(
      "vi-VN",
      {
        timeZone:
          "Asia/Ho_Chi_Minh"
      }
    );


  /*
     Giờ Việt Nam
  */

  const time =
    now.toLocaleTimeString(
      "vi-VN",
      {
        timeZone:
          "Asia/Ho_Chi_Minh",

        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      }
    );


  /*
     Lấy các ca hôm nay
  */

  const todayRecords =
    db.records.filter(
      record =>
        record.user === req.user.name &&
        record.date === date
    );


  /*
     Nếu đang có ca chưa chấm ra
  */

  const openRecord =
    todayRecords.find(
      record => !record.out
    );


  if (openRecord) {

    return res.status(409).json({
      error:
        `Bạn đang ở ca ${openRecord.session} và chưa chấm công ra.`
    });
  }


  /*
     Tối đa 2 ca/ngày
  */

  if (todayRecords.length >= 2) {

    return res.status(409).json({
      error:
        "Bạn đã chấm đủ 2 ca trong ngày hôm nay."
    });
  }


  /*
     Xác định ca
  */

  const sessionNumber =
    todayRecords.length + 1;


  /*
     Tạo bản ghi
  */

  db.records.push({

    user:
      req.user.name,

    date:
      date,

    in:
      time,

    out:
      "",

    latitude:
      latitude,

    longitude:
      longitude,

    distance:
      Math.round(distance),

    session:
      sessionNumber

  });


  writeDB(db);


  return res.json({

    ok: true,

    message:
      `Đã chấm công vào ca ${sessionNumber}.`,

    session:
      sessionNumber,

    distance:
      Math.round(distance)

  });
});


/* =====================================================
   CHẤM CÔNG RA
===================================================== */

app.post("/api/checkout", auth, (req, res) => {

  if (req.user.role === "admin") {

    return res.status(403).json({
      error:
        "Admin không chấm công."
    });
  }


  const db = readDB();

  const now = new Date();


  const date =
    now.toLocaleDateString(
      "vi-VN",
      {
        timeZone:
          "Asia/Ho_Chi_Minh"
      }
    );


  const time =
    now.toLocaleTimeString(
      "vi-VN",
      {
        timeZone:
          "Asia/Ho_Chi_Minh",

        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      }
    );


  /*
     Tìm ca đang mở
  */

  const record =
    db.records
      .slice()
      .reverse()
      .find(
        item =>
          item.user === req.user.name &&
          item.date === date &&
          !item.out
      );


  if (!record) {

    return res.status(409).json({
      error:
        "Không tìm thấy ca đang mở."
    });
  }


  /*
     Ghi giờ ra
  */

  record.out = time;


  writeDB(db);


  return res.json({

    ok: true,

    message:
      `Đã chấm công ra ca ${record.session}.`,

    session:
      record.session,

    in:
      record.in,

    out:
      record.out

  });
});


/* =====================================================
   NHÂN VIÊN XEM LỊCH SỬ
===================================================== */

app.get(
  "/api/my-records",
  auth,
  (req, res) => {

    const db = readDB();

    const records =
      db.records
        .filter(
          record =>
            record.user === req.user.name
        )
        .slice()
        .reverse();

    res.json(records);
  }
);


/* =====================================================
   ADMIN XEM TẤT CẢ
===================================================== */

app.get(
  "/api/records",
  auth,
  admin,
  (req, res) => {

    const db = readDB();

    res.json(
      db.records
        .slice()
        .reverse()
    );
  }
);


/* =====================================================
   XUẤT EXCEL
===================================================== */

app.get(
  "/api/export",
  auth,
  admin,
  async (req, res) => {

    try {

      const db = readDB();

      const workbook =
        new ExcelJS.Workbook();


      workbook.creator =
        "Dương Triều Phát";

      workbook.created =
        new Date();


      const worksheet =
        workbook.addWorksheet(
          "Cham cong"
        );


      worksheet.columns = [

        {
          header: "Nhân viên",
          key: "user",
          width: 25
        },

        {
          header: "Ngày",
          key: "date",
          width: 15
        },

        {
          header: "Ca",
          key: "session",
          width: 10
        },

        {
          header: "Giờ vào",
          key: "in",
          width: 15
        },

        {
          header: "Giờ ra",
          key: "out",
          width: 15
        },

        {
          header:
            "Khoảng cách công ty (m)",
          key: "distance",
          width: 28
        }

      ];


      /*
         Tiêu đề
      */

      worksheet.getRow(1).font = {
        bold: true
      };


      /*
         Dữ liệu
      */

      db.records.forEach(record => {

        worksheet.addRow({

          user:
            record.user || "",

          date:
            record.date || "",

          session:
            record.session || "",

          in:
            record.in || "",

          out:
            record.out ||
            "Chưa chấm ra",

          distance:
            record.distance != null
              ? record.distance
              : ""

        });

      });


      /*
         Kẻ bảng
      */

      worksheet.eachRow(
        (row) => {

          row.eachCell(
            (cell) => {

              cell.border = {

                top: {
                  style: "thin"
                },

                left: {
                  style: "thin"
                },

                bottom: {
                  style: "thin"
                },

                right: {
                  style: "thin"
                }

              };

            }
          );

        }
      );


      /*
         Header căn giữa
      */

      worksheet.getRow(1).alignment = {
        horizontal: "center",
        vertical: "middle"
      };


      /*
         Nội dung
      */

      worksheet.eachRow(
        (row, rowNumber) => {

          if (rowNumber > 1) {

            row.alignment = {
              vertical: "middle"
            };

          }

        }
      );


      /*
         Header tải file
      */

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );


      res.setHeader(
        "Content-Disposition",
        "attachment; filename=Cham_cong_Duong_Trieu_Phat.xlsx"
      );


      /*
         Xuất Excel
      */

      await workbook.xlsx.write(res);

      res.end();


    } catch (error) {

      console.error(
        "Lỗi xuất Excel:",
        error
      );

      if (!res.headersSent) {

        res.status(500).json({
          error:
            "Không thể xuất file Excel."
        });

      }

    }

  }
);


/* =====================================================
   KIỂM TRA SERVER
===================================================== */

app.get(
  "/api/status",
  (req, res) => {

    res.json({
      ok: true,
      message:
        "Hệ thống chấm công đang hoạt động."
    });

  }
);


/* =====================================================
   CHẠY SERVER
===================================================== */

const PORT =
  process.env.PORT || 3000;


app.listen(
  PORT,
  () => {

    console.log(
      `DTP attendance running on port ${PORT}`
    );

  }
);
