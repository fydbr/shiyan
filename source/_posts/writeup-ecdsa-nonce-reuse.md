---
title: 两张盖过章的付款条 —— ECDSA nonce 重用伪造提款条
date: 2026-11-14 17:10:00
categories:
  - 题解
tags:
  - CTF
  - Crypto
  - ECDSA
description: 两条付款签名复用了同一个 ECDSA nonce，由此恢复私钥，再给空白提款条补一个合法签名，拿到 flag。
---

> **Flag：`flag{x47_62c45a6f383e}`**
>
> 一句话：两条付款签名用了同一个 ECDSA nonce（`r1 == r2`），由此恢复私钥，再给空白的提款条补一个合法签名。

---

## 1. 题目与入口

平台开启了 **TCP over WebSocket** 代理：把 `wss://…/api/proxy/<uuid>` 用 `wsrx connect` 拉到本地端口，再 `nc 127.0.0.1 <port>` 即可。本质是一个一次性交互的密码学服务：连上后先吐一段 banner，然后**只读一行输入**，答对给 flag，答错回 `no` 并断开。

banner 长这样（每次连接都会重新生成密钥，所以数值每次都不同）：

```text
curve=secp256k1
hash=sha256d
p=fffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f
n=fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141
a=0
b=7
Gx=79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798
Gy=483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8
Qx=da974c13cbf61014ca86e8619894048b029b1bd8a8547c379b23effc8c00425b
Qy=acbff4364a0cccce5f44014f086eabceb9249a43a69f3a66a7d43ed7e14fa16c
slip1=pay|from=desk|to=north|coin=100000000|n=1
r1=119975d9fdeaf96a356a301b2b2538068462bd4b1dde68b78c89b128352ab185
s1=26c66e65ecc3fd95e3a39e55cf8c870a799f8e6576a401047c7455e10929bd9d
slip2=pay|from=desk|to=south|coin=250000000|n=2
r2=119975d9fdeaf96a356a301b2b2538068462bd4b1dde68b78c89b128352ab185
s2=e35c944cbd03e2e37edafc9a4c30a996e917482556b7402689cdc5985454bd39
withdraw=withdraw|from=desk|to=bearer|coin=all|n=9
end
```

| 字段 | 含义 |
| --- | --- |
| `curve` / `p,a,b,Gx,Gy,n` | secp256k1 全部参数，直接照抄即可 |
| `hash=sha256d` | 签名时对消息做 **SHA256(SHA256(msg))**，取 32 字节大端整数再 mod n |
| `Qx,Qy` | 服务端公钥（私钥未知） |
| `slip1/slip2 + r,s` | 两张**已经盖过章**（已签名）的付款条 |
| `withdraw` | 还空着、等待盖章的提款条 |

题目文案里的“章”就是 ECDSA 签名，“两张已经盖过章的付款条”就是两组 `(r, s)`。

---

## 2. 漏洞点：`r1 == r2`

ECDSA 签名：

```
r = (k·G).x mod n
s = k⁻¹ · (z + r·d) mod n        // z = H(msg), d 为私钥
```

`r` 只由 nonce `k` 决定。两张付款条的 `r` 一模一样，说明服务端**两次签名复用了同一个 k**。于是同一个 `k` 出现在两个方程里：

```
s1·k = z1 + r·d  (mod n)
s2·k = z2 + r·d  (mod n)
```

两式相减，`d` 被消掉：

```
k = (z1 − z2) · (s1 − s2)⁻¹  mod n
```

再把 `k` 代回任一式：

```
d = (s1·k − z1) · r1⁻¹  mod n
```

私钥到手，任何消息都能盖章。

### 自检（很重要）

算完先验证 `d·G == Q`。这一步同时校验了三件事：哈希口径（是 `sha256d` 而不是单次 SHA256）、消息字节（是否带换行/空格）、曲线参数。本题里第一次算就精确等于 banner 的 `Q`，说明口径全对。

```python
assert point_mul(d, G) == Q
```

---

## 3. 给提款条盖章

待签消息就是 banner 里 `withdraw=` 后面的原样字符串（UTF-8，无换行）：

```
withdraw|from=desk|to=bearer|coin=all|n=9
```

用恢复出的 `d` 重新签一次，nonce 可以随便取新的（复用原来的 `k` 也行，验证方不关心）：

```python
z  = sha256d(msg)
kk = randbelow(n-1) + 1
r  = (kk·G).x mod n
s  = kk⁻¹ · (z + r·d) mod n
if s > n//2: s = n - s      # 规范化成 low-s，兼容严格校验器
```

---

## 4. 交互协议：只读一行

这是本题最容易卡住的地方——**协议细节 banner 里没写**。

实测结论：

1. 服务端**只读一行**（`readline` 语义），读到换行才处理；只发数据不带 `\n` 会一直挂着。
2. 提交格式是**一行、空格分隔的两个 64 位十六进制数**：

   ```text
   <r_hex> <s_hex>\n
   ```

3. 中间用 `\t` 分隔同样能过（解析器按空白切分）。
4. 其他写法一律回 `no` 并断开，包括：`r=…,s=…`、`r=…\ns=…`、`<r><s>` 拼接、JSON、DER 编码、只交私钥/`k` 等。

> 判定“只读一行”的小技巧：先发 `r=<合法 64 位 hex>\n` 但**不发 s**。若服务端在等第二行，会超时无响应；若只读一行，会立刻回 `no`。本题是后者。再配合“不带换行则必超时”，就能确定协议是单行 `readline`。

另一个坑：**每次连接都重新生成密钥**，banner 里的 `Q`、`r1`、`s1`、`s2` 每次都不一样。所以“先连一次拿数据、算完再连一次提交”必然失败——恢复私钥、签名、提交必须在**同一条连接**内完成。

---

## 5. 完整脚本

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ECDSA nonce 重用 -> 伪造提款条
用法: python solve.py "wss://host/api/proxy/<uuid>"
依赖: pip install websockets
"""
import asyncio, hashlib, secrets, ssl, sys
import websockets

P  = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F
N  = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
GX = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798
GY = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8
G  = (GX, GY)


def point_add(A, B):
    if A is None: return B
    if B is None: return A
    x1, y1 = A; x2, y2 = B
    if x1 == x2 and (y1 + y2) % P == 0: return None
    if A == B: lam = 3 * x1 * x1 * pow(2 * y1, -1, P) % P
    else:      lam = (y2 - y1) * pow(x2 - x1, -1, P) % P
    x3 = (lam * lam - x1 - x2) % P
    return x3, (lam * (x1 - x3) - y1) % P


def point_mul(k, A):
    R = None
    while k:
        if k & 1: R = point_add(R, A)
        A = point_add(A, A); k >>= 1
    return R


def sha256d(msg: bytes) -> int:
    return int.from_bytes(hashlib.sha256(hashlib.sha256(msg).digest()).digest(), "big") % N


async def solve(url: str) -> str:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    async with websockets.connect(url, ssl=ctx, open_timeout=15, ping_interval=None) as ws:
        banner = b""
        while b"end\n" not in banner:
            banner += await asyncio.wait_for(ws.recv(), timeout=15)
        info = dict(l.split("=", 1) for l in banner.decode().splitlines() if "=" in l)

        r1, s1, s2 = int(info["r1"], 16), int(info["s1"], 16), int(info["s2"], 16)
        Q = (int(info["Qx"], 16), int(info["Qy"], 16))

        # 1) 同一 nonce 复用 -> 恢复 k 与私钥 d
        z1 = sha256d(info["slip1"].encode())
        z2 = sha256d(info["slip2"].encode())
        k = (z1 - z2) * pow(s1 - s2, -1, N) % N
        d = (s1 * k - z1) * pow(r1, -1, N) % N

        # 2) 自检
        assert point_mul(d, G) == Q, "私钥恢复失败:检查 hash 与消息字节"

        # 3) 给提款条签名
        z = sha256d(info["withdraw"].encode())
        kk = secrets.randbelow(N - 1) + 1
        r = point_mul(kk, G)[0] % N
        s = pow(kk, -1, N) * (z + r * d) % N
        if s > N // 2: s = N - s

        # 4) 单行提交: "<r_hex> <s_hex>"
        await ws.send(f"{r:064x} {s:064x}\n".encode())
        return (await asyncio.wait_for(ws.recv(), timeout=10)).decode().strip()


if __name__ == "__main__":
    print(asyncio.run(solve(sys.argv[1])))
```

运行：

```bash
python solve.py "wss://ctf.example.com/api/proxy/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
# flag{x47_62c45a6f383e}
```

---

## 6. 时间线与踩坑记录

1. 连上拿到 banner，`r1 == r2` 一眼看出 nonce 重用，公式三分钟推完。
2. 卡在**提交格式**：先试 `r=…\ns=…`、`r=…,s=…`、拼接、JSON、DER，全部 `no`。
3. 用“只发 `r=` 一行、不发 `s`”做对照实验，发现服务端**只读一行**，据此把搜索空间压到单行格式。
4. 枚举分隔符时，`"<r> <s>\n"` 命中，返回 flag；再用 `\t` 分隔复现一次，确认解析器按空白切分。

## 7. 修复建议

- **每次签名必须使用密码学安全随机、且互不复用的 nonce**（RFC 6979 确定性 nonce 也可）。
- 不要自己实现 ECDSA；用经过审计的库。
- 服务端不要泄露同一密钥下的重复 `r`；若已泄露，应立即轮换密钥。
