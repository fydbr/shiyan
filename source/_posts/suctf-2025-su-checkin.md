---
title: 入门 CTF 的一道题，学会鲨鱼使用和简单爆破，SUCTF 2025 · SU_Checkin 题解（思考过程版）
date: 2026-11-04 12:30:00
tags:
  - CTF
  - Misc
  - 流量分析
  - Wireshark
  - Jasypt
categories:
  - CTF
description: 附件是 zip 套 XZ，鲨鱼打不开；打开后又要在 143 个会话里找出 7 个真正有用的请求；读到的密码还被截断了 4 位。按我当时真实的疑问顺序复盘一遍。
---

> **签到题 · Misc / 流量取证 · 按解题时的真实疑问顺序复盘**
>
> 题目入口：附件 `SU_Checkin.zip` →（XZ 压缩）→ `SU_Checkin.pcapng`（10.8 MB 抓包）
>
> 最终 flag：`SUCTF{338dbe11-e9f6-4e46-b1e5-eca84fb6af3f}`
>
> 解题链：解包 → 筛会话 → 追 stream 50 → LFI 三件套 → 补密码爆破 → Jasypt 解密

这是一道签到题，但它把"流量题该有的流程"完整走了一遍：**先修容器，再找入口，然后读文件，最后破解**。写完这篇，我大概知道了下次拿到 pcap 该先做什么。

下面完全按我当时的懵圈顺序写。

## 疑问 ①：为什么 Wireshark 直接打不开？

### 第一反应

拿到附件双击，资源管理器报"压缩文件夹无效/为空"，连 `pcapng` 都拖不出来。

第一反应是附件坏了，差点去重新下载。

### 解

其实是 **zip 套 pcapng**，但 zip 里的条目用了压缩方法 **95（XZ）**。Windows 资源管理器不支持，Python 的 `zipfile.read()` 也一样，直接抛 `NotImplementedError`。

对策是别用库的高层接口，手动把压缩流抠出来交给 `lzma`：

```python
import zipfile, lzma, struct

data = open('SU_Checkin.zip', 'rb').read()
zf   = zipfile.ZipFile('SU_Checkin.zip')
info = zf.infolist()[0]          # SU_Checkin.pcapng, compress_type == 95

idx  = data.find(b'PK\x03\x04')
nlen = struct.unpack('<H', data[idx+26:idx+28])[0]   # 文件名长度
elen = struct.unpack('<H', data[idx+28:idx+30])[0]   # 扩展字段长度

head = idx + 30 + nlen + elen
comp = data[head : head + info.compress_size]

out = lzma.decompress(comp, format=lzma.FORMAT_XZ)
open('SU_Checkin.pcapng', 'wb').write(out)           # 10.8 MB
```

解出来先验一下是不是正经抓包：魔数 `0a0d0d0a`、字节序 `1A2B3C4D`、版本 1.0 —— 标准 pcapng，鲨鱼直接打开没问题。

> **收获**：附件的"容器"本身就是第一道坎。CTF 里凡是"文件打不开"，先怀疑容器，别怀疑人生。

## 疑问 ②：一屏扫描流量，143 个会话哪条才是正主？

### 第一反应

打开之后是一屏密密麻麻的 HTTP，重组出 **143 个会话**，路径全是 `/.htaccess`、`/php.zip` 这种 404 —— 看起来每条都长得一样，攻击藏在哪里？

### 解：按信号强度逐层筛

先做全量统计，看状态码分布就够定调了：

| 状态码 | 数量 | 说明 |
| --- | --- | --- |
| 404 | 10931 | dirsearch 扫描噪音（Spring Boot 统一错误模板） |
| 200 | 8 | 7 个 `/download` 文件读取 + 1 个 `/index.html` |
| 400 | 8 | 畸形请求 |
| 500 | 2 | 报错 |
| 302 | 1 | 跳转 |

一条过滤器把 10931 条噪音砍到 8 条：`http.response.code == 200`。

再叠加本题专属签名 —— 下载接口必带 `Content-Disposition: attachment`，把过滤条件接上去：

`http.response.code == 200 && http contains "attachment"`

收敛到 7 个。就算不看状态码，下面四个独立信号也都指向同一处：

- **UA 指纹**：10943 个请求是 `Chrome/87.0.4280.88` + `Accept-Language: *`（python-requests 伪装）；只有 7 个是 `Chrome/131.0.0.0` 的真浏览器头（`zh-CN`、`Upgrade-Insecure-Requests`）
- **节奏**：扫描 42 秒打了约 10900 发（约 4ms 一个，机器节奏）；攻击 7 发，每发间隔 5~6 秒（人的节奏）
- **连接复用**：100 个流每个塞满 100 个请求的 pipeline；攻击流只有 7 个
- **路径语义**：唯一带参数的请求，值里是 `../../` 穿越 —— 字典里不会有这种条目

四个信号叠在一起，`tcp.stream eq 50` 就是唯一解。

> **收获**：单信号可能巧合，多信号同源才可信。找"人的痕迹"比找"奇怪的包"更快。

## 疑问 ③：七个 200，读到的都是什么？

追 stream 50，七个响应的文件名直接写明了攻击者在干什么：

| 路径（filename 参数） | 读到什么 | 作用 |
| --- | --- | --- |
| `/root/flag.txt` | `nonono` | 直接读 flag，被拒 |
| `/proc/self/cmdline` | 启动参数里的密码，19 位，末尾被截断 | 关键线索 |
| `/root/start.sh` | 空 | 看启动脚本，没东西 |
| `BOOT-INF/classes/hint` | `algorithm=PBEWithMD5AndDES` | 加密算法 |
| `BOOT-INF/classes/application.properties` | 一行 base64 密文 | 待解密的内容 |
| `/etc/passwd` | 用户列表 | 摸清环境 |
| `/etc/shadow` | `root:$6$MI.uuGSS…` | 想爆 root，未果 |

`/proc/self/cmdline` 在鲨鱼里长这样 —— 十六进制和右侧 ASCII 列对着看，密码就明晃晃地躺在那儿：

![Wireshark 中 stream 50 的 cmdline 响应](/shiyan/images/suctf-checkin/wireshark-hex.webp)

`\x00` 是 argv 分隔符，所以看到的是 `java\x00-jar\x00suctf-0.0.1-SNAPSHOT.jar\x00--password=SePassWordLen23SUCT...` 这样的连串。

`application.properties` 里的那条 `OUTPUT` 就是最终要解的东西：

```ini
spring.application.name=suctf
server.port = 8888
OUTPUT=ElV+bGCnJYHVR8m23GLhprTGY0gHi/tNXBkGBtQusB/zs0uIHHoXMJoYd6oSOoKuFWmAHYrxkbg=
```

> **收获**：LFI 打 Spring Boot 有一套固定清单 —— `cmdline` 拿启动参数、`application.properties` 拿配置、`BOOT-INF/classes` 拿编译后的资源。这三个文件基本能拼出全部秘密。

## 疑问 ④：密码少 4 位，怎么补？

### 第一反应

`--password=SePassWordLen23SUCT` 在 `\x00` 之前就断在这里了 —— 是 `/proc/self/cmdline` 有长度上限（内核 `ARG_MAX` 附近截断），还是密码本来就这么长？

试着拿它去解密，失败。说明**确实被截断了**。

### 解：Jasypt 的加密结构

`hint` 说算法是 `PBEWithMD5AndDES`，这是 Java 里 Jasypt 的默认算法。密文 `OUTPUT` base64 解开是 **56 字节**：

- 前 8 字节：随机盐 `12557e6c60a72581`
- 后 48 字节：DES-CBC 密文

密钥的推导过程是 PBKDF1-MD5：**1000 次迭代**，得到 16 字节，前 8 字节当 DES key，后 8 字节当 IV。

```python
def jasypt_decrypt(pwd: bytes) -> str | None:
    d = hashlib.md5(pwd + salt).digest()
    for _ in range(999):
        d = hashlib.md5(d).digest()
    pt = DES.new(d[:8], DES.MODE_CBC, d[8:16]).decrypt(ct)
    n = pt[-1]
    if 1 <= n <= 8 and pt.endswith(bytes([n]) * n):   # PKCS5 合法
        try:
            return pt[:-n].decode('utf-8')
        except UnicodeDecodeError:
            return None
    return None
```

剩下 4 位怎么补？

1. 密码是 23 位，已知 19 位 → 还差 4 位
2. 比赛叫 **SUCTF**，密码里大概率有这个标记 → 先补一个 `F`
3. 还剩 3 位 → 字母数字全排列，`62³ ≈ 23.8 万` 组，绰绰有余

### 爆破

完整脚本我放在文末下载里，核心就一个循环：

```python
alpha = string.digits + string.ascii_letters   # 数字优先，666 靠前
tried = 0
for a, b, c in itertools.product(alpha, repeat=3):
    pwd = KNOWN_PWD + 'F' + a + b + c          # 19 + 1 + 3 = 23
    r = jasypt_decrypt(pwd.encode())
    tried += 1
    if r:
        print(f"[*] 命中！密码 = {pwd}  (尝试 {tried} 组)")
        print(f"[+] FLAG: {r}")
        return
```

跑起来：

![爆破脚本运行结果](/shiyan/images/suctf-checkin/brute-output.webp)

```
[*] 密文 56B = 盐 12557e6c60a72581 + DES-CBC 48B，迭代 1000
    ...已试 5000 组
    ...已试 10000 组
    ...已试 15000 组
    ...已试 20000 组
[*] 命中！密码 = SePassWordLen23SUCTF666  (尝试 23443 组)
[+] FLAG: SUCTF{338dbe11-e9f6-4e46-b1e5-eca84fb6af3f}
```

23443 组，几秒钟的事。补的那个 `F` 猜对了，末三位是 `666`。

## 复盘：这道"签到题"教了我什么

1. **容器先行**。打不开的文件先看 ZIP 的 `compress_type`，95 是 XZ，0 是存储，8 是 deflate。库读不了就手动抠。
2. **用状态码做第一次降噪**。10931 条 404 里是找不出攻击的，`http.response.code == 200` 一条就够。
3. **多信号交叉验证**。UA、节奏、连接复用、路径形态 —— 四个信号同时指向 stream 50，才敢确定。
4. **流量题的本质是"读文件"**。LFI 三件套（cmdline / application.properties / BOOT-INF/classes）几乎通吃 Spring Boot 靶机。
5. **爆破要算清楚空间**。`62³` 是能跑的，`62⁴` 就该考虑字典或规则了。这次恰好有个 `SUCTF` 的提示把 4 位降到 3 位。
6. **PKCS5 校验不能省**。不校验填充，随便一个错误密码都可能"解密成功"出乱码，白白误导自己。

## 附录：响应原文与脚本

七个响应的完整内容打包在下面（含 `cmdline` 的原始二进制、`/etc/passwd`、`/etc/shadow` 全文）：

[下载 SU_Checkin-loot.zip](/shiyan/downloads/SU_Checkin-loot.zip)

几个关键文件的原文：

**04-hint.txt**

```text
algorithm=PBEWithMD5AndDES
```

**05-application.properties.txt**

```ini
spring.application.name=suctf
server.port = 8888
OUTPUT=ElV+bGCnJYHVR8m23GLhprTGY0gHi/tNXBkGBtQusB/zs0uIHHoXMJoYd6oSOoKuFWmAHYrxkbg=
```

**06-root-flag.txt**

```text
nonono
```

**03-proc-self-cmdline.bin**（`\x00` 已替换为空格便于阅读）

```text
java -jar suctf-0.0.1-SNAPSHOT.jar --password=SePassWordLen23SUCT
```

`/etc/shadow` 里 root 的哈希是 `$6$`（SHA-512 crypt），当时也试着爆了一下，没出结果 —— 说明出题人没打算让你走这条路，真正的钥匙还是 `cmdline` 里那 19 位。
