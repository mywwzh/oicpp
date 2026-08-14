# OICPP 插件制作文档

OICPP 插件是运行在编辑器渲染进程中的可信 JavaScript 扩展。插件可以注册命令、读取或修改当前编辑器内容、显示消息、打开外部链接，并保存自己的少量配置。

> 安全提示：插件代码与 OICPP 界面运行在同一页面上下文中。只安装来源可信、已审查过的插件。

## 1. 安装目录

用户插件放在：

- Windows：`%USERPROFILE%\.oicpp\plugins\<插件目录>`
- macOS / Linux：`~/.oicpp/plugins/<插件目录>`

每个插件必须独占一个子目录。放入文件后，在 OICPP 顶部选择“插件 -> 重新加载插件”。也可以打开“插件管理器”启用或停用插件，无需重启应用。

项目内置示例位于 `plugins/oicpp.code-stats`，可作为最小模板。

## 2. 目录结构

```text
my-first-plugin/
├── plugin.json
└── index.js
```

`plugin.json`：

```json
{
  "id": "your-name.my-first-plugin",
  "name": "My First Plugin",
  "version": "1.0.0",
  "description": "Shows information about the current editor.",
  "author": "Your Name",
  "main": "index.js",
  "engines": {
    "oicpp": ">=1.5.0"
  },
  "contributes": {
    "commands": [
      {
        "command": "your-name.my-first-plugin.hello",
        "title": "Hello from Plugin"
      }
    ],
    "menus": {
      "plugins": [
        {
          "command": "your-name.my-first-plugin.hello",
          "group": "general"
        }
      ]
    }
  }
}
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 全局唯一 ID，只能含小写字母、数字、点、下划线和连字符，长度 2-64。 |
| `name` | 否 | 展示名称，默认使用 `id`。 |
| `version` | 否 | 插件版本，建议使用语义化版本。 |
| `description` | 否 | 插件管理器中的说明。 |
| `author` | 否 | 字符串，或含 `name` 的对象。 |
| `main` | 否 | 入口 JS，相对于插件目录，默认 `index.js`，不能越过插件目录。 |
| `engines.oicpp` | 否 | 声明目标 OICPP 版本；当前作为元数据展示。 |
| `contributes.commands` | 否 | 声明命令标题；未配置菜单时，这些命令会自动出现在顶部“插件”菜单。 |
| `contributes.menus.plugins` | 否 | 指定顶部“插件”菜单中的命令及分组。 |

## 3. 编写入口

入口使用 CommonJS 导出 `activate`，可选导出 `deactivate`：

```js
function activate(oicpp) {
    oicpp.commands.registerCommand('your-name.my-first-plugin.hello', () => {
        const filePath = oicpp.workspace.getActiveFilePath();
        const selected = oicpp.workspace.getSelectedText();

        if (selected) {
            oicpp.window.showMessage(`Selected ${selected.length} characters`, 'info');
        } else {
            oicpp.window.showMessage(filePath || 'No file is open', 'info');
        }
    });
}

async function deactivate() {
    // 可选：释放插件自行创建、但未加入 subscriptions 的资源。
}

module.exports = { activate, deactivate };
```

命令 ID 必须以插件 ID 加点号开头。例如插件 ID 为 `your-name.my-first-plugin`，命令应使用 `your-name.my-first-plugin.hello`。

`registerCommand` 返回的资源会自动加入当前插件的订阅列表。插件自行创建的可释放资源，可以用：

```js
oicpp.subscriptions.push({
    dispose() {
        // 清理监听器、定时器等
    }
});
```

## 4. API 参考（API v1）

### 基本信息

- `oicpp.apiVersion`：当前 API 版本，现为 `1`。
- `oicpp.app.version` / `oicpp.app.getVersion()`：OICPP 版本。
- `oicpp.app.getLocale()`：当前界面语言代码。
- `oicpp.plugin`：当前插件的 `id`、`name`、`version`、`builtin`。

### 命令

- `oicpp.commands.registerCommand(id, handler)`：注册命令。
- `oicpp.commands.executeCommand(id, ...args)`：执行已注册命令，返回 Promise。

### 编辑器与工作区

- `oicpp.workspace.getActiveFilePath()`：当前文件路径，无文件时返回 `null`。
- `oicpp.workspace.getActiveDocument()`：返回当前文档的 `filePath`、`name`、`languageId`、`content` 和 `selectionText`，无编辑器时返回 `null`。
- `oicpp.workspace.getText()`：获取当前编辑器全文。
- `oicpp.workspace.getSelectedText()`：获取选中文本。
- `oicpp.workspace.insertText(text)`：在当前选择或光标处插入文本。
- `oicpp.workspace.replaceText(text)`：替换当前编辑器全文，成功返回 `true`。

### 界面与环境

- `oicpp.window.showMessage(message, type)`：显示提示；`type` 可为 `info`、`success`、`warning`、`error`。`oicpp.ui.showMessage` 是等价写法。
- `oicpp.ui.setStatusBarText(text, options)`：设置插件状态栏文字。`options` 支持 `alignment`、`priority`、`tooltip` 和点击时执行的 `command`。
- `oicpp.ui.clearStatusBarText()`：清除当前插件的状态栏文字。
- `oicpp.env.openExternal(url)`：使用系统浏览器打开 URL。
- `oicpp.log.info/warn/error(...args)`：写入带插件 ID 前缀的 OICPP 日志。

### 插件存储

存储基于插件 ID 隔离，值必须可被 JSON 序列化：

```js
const count = oicpp.storage.get('runCount', 0) + 1;
oicpp.storage.set('runCount', count);
oicpp.storage.delete('runCount');
```

## 5. 调试与发布

1. 执行 `npm run dev` 启动带开发者工具的 OICPP。
2. 把插件目录放入用户插件目录。
3. 在“插件”菜单中点击“重新加载插件”。
4. 激活失败、命令异常和清理异常会记录在开发者工具控制台及 OICPP 日志中。
5. 发布时打包整个插件目录，确保 `plugin.json` 和入口文件位于压缩包顶层目录内。用户解压到插件目录即可安装。

常见错误：

- “Duplicate plugin id”：另一个插件使用了相同 `id`。
- “entry file not found”：`main` 指向的文件不存在。
- “main must stay inside”：入口路径越过了插件目录。
- “command is already registered”：两个插件注册了同一命令，或插件重复注册。

## 6. 当前边界

- 插件入口仅支持单个 JavaScript 文件；如需多文件，可在发布前用 esbuild、Rollup 或 webpack 打包。
- 插件入口中没有 Node.js `require`，文档中的 `oicpp` 对象是唯一保证兼容性的稳定接口。插件与 OICPP 界面运行在同一页面上下文，技术上仍可访问页面全局对象和 DOM；这些内部对象不属于兼容性承诺，也不应在正式插件中使用。
- `engines.oicpp` 当前不执行版本范围阻止，只用于声明兼容性。
