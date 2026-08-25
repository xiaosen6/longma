# 安装 geo-optimizer-skill CLI

用户没装 Python / uv 时才看这份。对用户说话用人话，不要念包名堆砌。

## 推荐：uv（一次跑、不必全局装）

https://docs.astral.sh/uv/

安装 uv 之后本 skill 的 `scripts/run_geo.py` 会走：

```bash
uvx --from geo-optimizer-skill geo audit --url https://example.com
```

Windows PowerShell 装 uv（任选官方文档当前推荐方式）。装好后新开一个终端再试。

## 备选：pip

需要本机 Python 3.9+：

```bash
pip install geo-optimizer-skill
geo --help
```

## 验证

```bash
python <skill>/scripts/run_geo.py audit --url https://example.com
```

能打出 0–100 分就算成功。第一次 `uvx` 会下载包，可能要等一两分钟。

## 网络

下载 PyPI 失败时，让用户配国内镜像后再试，或改用已能访问 pypi.org 的网络。不要改用户站点代码来「绕过安装」。
