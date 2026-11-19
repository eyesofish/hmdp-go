# 本地生活商户点评与优惠券平台（Go 后端）

## 目录

- [项目概览](#项目概览)
- [开发实例：用 SDD 和 TDD 修复抢购成功提示](#开发实例用-sdd-和-tdd-修复抢购成功提示)
- [技术栈](#技术栈)
- [Quick Start](#quick-start)
- [测试](#测试)
- [架构亮点与核心技术选型](docs/architecture-highlights.md#架构亮点与核心技术选型)
- [亮点难点](docs/architecture-highlights.md#亮点难点)

## 项目概览

本项目是基于 Go 语言生态对经典 O2O 社交与营销平台（[原黑马点评](https://www.bilibili.com/video/BV1NV411u7GE/)）的深度重构与架构升级。项目模拟了类似大众点评的核心业务场景，完成了从用户鉴权、商户查询、社交探店、到高并发秒杀抢券的完整业务闭环。

项目用三个版本展示秒杀链路从同步事务、Channel 入队原型到 Kafka 异步落库的演进，并实现 Redis 登录态、空值缓存与互斥重建、Lua 原子预扣、数据库最终约束和可取消的优雅停机。重点是能解释实现、边界和取舍，而不是用未经验证的数据包装吞吐能力。

- [原版 Java 架构参考](https://github.com/KNeegcyao/dianping)

## 开发实例：用 SDD 和 TDD 修复抢购成功提示

**用 SDD（规格驱动开发）确定“成功”的含义。** 最初的需求是让用户看到的订单号与后台逐位一致。评审时，我把“订单号已生成，但 Kafka 消费者还没把订单写进 MySQL”单独列成一个场景，并定下验收规则：此时页面只能显示“订单处理中，请勿重复提交”，禁用该券的按钮并自动查询；只有确认订单已提交，才显示“抢购成功”和完整订单号。[产品需求](docs/prd-seckill-order-id.md) · [验收场景](specs/001-seckill-order-confirmation/spec.md)

**先约定接口，再拆任务。** 下单接口返回十进制字符串，避免大整数在浏览器中丢失精度；确认接口只查询当前用户已提交的订单。有了这份约定，我把工作拆成四步：用浏览器复现问题、实现后端查询、实现页面状态、在 PR 上联调验收。后端和前端都以同一份规格为准。[实施计划](specs/001-seckill-order-confirmation/plan.md) · [任务清单](specs/001-seckill-order-confirmation/tasks.md)

**用 TDD（测试驱动开发）先拿到红灯。** 改业务代码之前，我先写 Playwright 用例，让已登录用户在真实商铺详情页点击抢购。测试持有该券的 MySQL 库存行锁，让请求可以受理、订单暂时无法落库。旧页面实际显示了“抢购成功”，而按用户 ID 和券 ID 查询的订单数为零。这条断言在旧版本 `8b6de42` 上失败。[浏览器用例](tests/e2e/order-confirmation.spec.mjs) · [红灯日志](https://github.com/eyesofish/hmdp-go/actions/runs/44430510388)

**用同一条用例验收修复。** 修复后，持锁期间重复点击只发出一次下单请求。释放锁后，测试从 MySQL 独立读取订单号文本，再与用户看到的号码逐位比较。提交 `954b959` 的 PR 检查中，两者均为 `661657420098961409`。本地和 PR CI 共用 `npm --prefix tests/e2e test`；后续改动如果再次提前报成功或丢失订单号末位，就会触发回归测试失败。[绿灯日志](https://github.com/eyesofish/hmdp-go/actions/runs/44430915764)

## 技术栈

- Go 1.25.6
- Gin
- GORM
- MySQL
- Redis
- Lua
- Kafka

## Quick Start

本节目标：让你在本地最短路径跑起来后端服务。

### 1. 前置依赖

- Go: `>= 1.25.6`
- MySQL: `8.x`
- Redis: `6.x/7.x`
- Kafka: `3.x`（或兼容发行版）
- 可选前端：仓库已包含黑马点评课程的静态页面，使用 Docker Compose 启动。

### 2. 拉取依赖

```bash
go mod download
```

### 3. 准备数据库与中间件

确保以下地址可访问（默认与 `config/config.yaml` 一致）：

- MySQL: `127.0.0.1:3306`
- Redis: `127.0.0.1:6379`
- Kafka: `127.0.0.1:9092`

并提前创建数据库与 Topic：

- MySQL 数据库：`hmdp`，建表脚本`hmdp.sql`已提供。
- Kafka Topic：`voucher-order-topic`

如果已经导入过旧版 SQL，需要补上一人一券的数据库最终约束：

```sql
ALTER TABLE tb_voucher_order
ADD UNIQUE INDEX uk_voucher_order_user_voucher (user_id, voucher_id);
```

#### 可选：在本机用 Docker 提供依赖

Go 服务仍在宿主机运行。MySQL、Redis 和 Kafka 可以分别使用已有实例，也可以用容器提供。容器将端口映射到上面列出的回环地址，因此 Go 服务可直接使用仓库的默认配置。已有实例占用对应端口时，跳过该容器，并确认已有实例的连接配置、库表或 Topic 已就绪。

在仓库根目录使用 Docker Compose 2.30 或更高版本。首次启动会将 `hmdp.sql` 导入空 MySQL 卷，创建 Kafka Topic `voucher-order-topic`。`--wait` 会等到服务就绪。MySQL 沿用项目本地开发配置（`root` 空密码），三个服务的发布端口均绑定到本机。

```powershell
docker compose up -d --wait
docker compose ps
```

如果已有 MySQL 和 Redis，只需执行 `docker compose up -d --wait kafka`。其他服务也可以按名称单独启动。启动 Go 应用后，按第 6 节请求商铺分类接口；要确认 Kafka 消费者已加入组，可执行：

```powershell
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server kafka:29092 --describe --group voucher-order-group --members --verbose
```

执行 `docker compose down` 会停止并移除容器，保留数据卷。下次再运行 `docker compose up -d --wait` 就会使用原数据。

**从手工创建的容器切换**。如果此前按本项目的 `docker run` 步骤启动过依赖，先停 Go 服务，再执行以下 PowerShell 命令，让 Compose 复用原卷。先用 `docker volume inspect` 确认三个卷确实存在；端口和卷都应在旧容器停止后再交给 Compose。

```powershell
$env:HMDP_MYSQL_VOLUME = 'hmdp-mysql-data'
$env:HMDP_KAFKA_VOLUME = 'hmdp-kafka-data'
$env:HMDP_REDIS_VOLUME = docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' hmdp-redis
docker volume inspect $env:HMDP_MYSQL_VOLUME $env:HMDP_REDIS_VOLUME $env:HMDP_KAFKA_VOLUME
docker stop hmdp-mysql hmdp-redis hmdp-kafka
docker compose up -d --wait
```

以上卷名设置仅在当前 PowerShell 生效。要在新终端继续使用原卷，把这三个变量及其实际值写入本地 `.env`。

### 4. 修改配置

编辑 `config/config.yaml`，重点检查以下字段：

- `mysql.username`
- `mysql.password`
- `mysql.dbname`
- `redis.host` / `redis.port`
- `kafka.brokers`
- `kafka.topic`
- `server.port`

### 5. 启动服务

```bash
go run ./cmd/api/main.go
```

启动成功后默认监听：`http://localhost:8081`

要打开网页，在仓库根目录的另一个终端运行：

```bash
docker compose up -d frontend
```

打开 [本地前端](http://127.0.0.1:8080/)。Nginx 提供 `frontend/public` 中的页面，将 `/api/` 请求转发到宿主机 Go 服务的 8081 端口。前端资源取自课程压缩包的 `nginx-1.18.0/html/hmdp/` 目录。[GitHub 来源（固定版本）](https://github.com/lhpqaq/xzdp-go/blob/8be36c8a1c2b93d465ab6e89790c5bfeaca3f2f7/resources/nginx-1.18.0.zip)

### 6. 快速验证

可先调用一个无需登录的接口确认服务可用：

```bash
curl http://localhost:8081/shop-type/list
```

### 常见问题

- Redis 连接失败：检查 `redis.host + redis.port` 是否可达（端口字段写 `6379`，代码会拼接冒号）。
- Kafka 无法消费：确认 `group_id`、`topic` 与 broker 地址一致，且 broker 对外地址可被本机访问。
- MySQL 认证失败：检查账号密码、数据库名与字符集配置。

## 测试

### 默认验证（无需 MySQL、Redis、Kafka）

```bash
go test -race -count=1 ./...
```

默认测试覆盖 Kafka 消息构造与错误传播、消费者重试/提交顺序、Channel 取消语义和锁 Key 规则。CI 执行同一条命令。

### 浏览器验收：秒杀订单确认

从仓库根目录执行以下命令。需要 Docker Compose 2.30+、Node.js 20+（CI 使用 24）和 npm。首次安装浏览器时，在 Linux 上可以加 `--with-deps` 安装系统依赖。

```bash
npm --prefix tests/e2e ci
cd tests/e2e
npx playwright install chromium
cd ../..
npm --prefix tests/e2e test
```

测试入口创建独立的 MySQL、Redis、Kafka、Go API 和 Nginx，使用临时卷及动态本机端口。浏览器以测试用户在商铺详情页点击“限时抢购”。测试先锁住该券的库存行，检查未落库时的提示和重复点击，再释放锁，按用户与券查库，逐位核对成功提示中的订单号。结束后入口清理本次 Compose 项目。PR 的 `e2e` 检查执行同一条命令。

### 集成测试

集成测试会连接并修改 `config/config.yaml` 指向的 MySQL 和 Redis，只应在独立测试环境运行：

```bash
go test -p=1 -v -count=1 -timeout 180s -tags=integration \
  ./internal/util/ \
  ./internal/service/seckill/ \
  ./internal/service/order/ \
  ./internal/service/
```

### 接入路径压测

压测不会随 `go test ./...` 自动执行：

```bash
go test -v -count=1 -timeout 600s -tags=load \
  -run '^TestLoadTest' ./internal/service/
```

V2/V3 压测使用内存队列或 fake Kafka writer，避免污染业务 Topic；结果只衡量 Redis 准入与应用内处理，不包含 broker 或异步落库，因此不能冒充端到端订单吞吐。

### 生成测试报告

```bash
./scripts/gen-test-report.sh
```

报告写入 `docs/test-report.md`。脚本不会吞掉测试失败；任一测试失败时会以非零状态退出。

### 测试覆盖范围

| 模块 | 测试文件 | 覆盖内容 |
|------|---------|---------|
| KafkaExecutor | `order/kafka_executor_test.go` | 消息 Key/JSON、投递错误传播 |
| Kafka Consumer | `service/voucher_order_consumer_test.go` | 处理失败不提交、提交失败不重复落库、幂等重放 |
| ChannelExecutor | `order/channel_executor_test.go` | 入队、顺序、队列满时响应 Context |
| RedissonLock | `util/redisson_lock_test.go` | Key 规则；集成标签验证加锁与解锁 |
| PreCheck / SyncExecutor | `-tags=integration` | Redis Lua、补偿、MySQL 事务与并发 |
| 接入路径压测 | `-tags=load` | 固定并发上限下的 QPS 与延迟分位数 |

## 架构亮点与核心技术选型

详见 [docs/architecture-highlights.md](docs/architecture-highlights.md)
