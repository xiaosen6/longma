# geo-optimizer-skill 命令速查

引擎：`geo-optimizer-skill`（MIT，https://github.com/Auriti-Labs/geo-optimizer-skill）。

实际调用优先：

```text
python <skill>/scripts/run_geo.py <subcommand> ...
```

已把 `geo` 装到 PATH 时，可直接 `geo <subcommand>`。

## 常用

```bash
# 体检（先做这个）
geo audit --url https://example.com
geo audit --url https://example.com --format json
geo audit --url https://example.com --format html
geo audit --sitemap https://example.com/sitemap.xml --max-urls 25

# 生成 llms.txt
geo llms --base-url https://example.com --site-name "Name" --description "One sentence." --output ./llms.txt

# JSON-LD：website | webapp | faq | article | organization | breadcrumb
geo schema --type website --url https://example.com
geo schema --type faq --url https://example.com/faq

# 补丁：先不加 --apply 预览
geo fix --url https://example.com
geo fix --url https://example.com --apply
geo fix --url https://example.com --only robots,llms,schema --apply

# 对比 / 历史
geo diff --before https://example.com/old --after https://example.com/new
geo history --url https://example.com

# 可选：问真实模型有没有引用你（要 API Key）
# PERPLEXITY_API_KEY 推荐
geo citations --brand "Brand" --domain example.com --topic "your category"
```

`--format`：`text`（默认）`json` `rich` `html` `github` `ci` `pdf`

## 分数档

| 分 | 档 |
| --- | --- |
| 86–100 | 优秀 |
| 68–85 | 良好 |
| 36–67 | 打底 |
| 0–35 | 危急 |

## 不要做的

- 不要编造 CLI 没有输出的分数。
- 不要在用户未同意时 `--apply`。
- 不要把 `geo citations` 当成默认步骤。
