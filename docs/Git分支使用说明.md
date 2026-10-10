# BlockCanvas · Git 分支使用说明（自用备忘）

> 写给不靠命令行吃饭的人：**先看懂"分支到底是啥"，再记住几条安全动作**，
> 剩下 90% 的场景都能自己搞定。命令都用大白话解释，GitHub Desktop 的对应操作也标了。
>
> 本仓库当前的实际情况（写这份文档时的状态）：
> - `main` → 稳定发布线（`9b6dcc1`）
> - `alpha` → 开发线（`a92718f`），**比 main 多 6 个提交**
> - `backup-v042`、`rescue-wip` → 历史快照分支，只读，留着当备份
> - 远程：`origin/main`、`origin/alpha`

---

## 一、先建立正确的心智模型

### 1. 提交（commit）是"快照"，分支（branch）只是"一张贴在快照上的便签"

```
提交 A ← 提交 B ← 提交 C
                    ↑
                 alpha   ← 分支 = 指向某个提交的可移动指针（就 41 字节，一个文件）
```

关键结论（下面所有"不懂的地方"都是这一条的推论）：

1. **提交不属于任何分支**。提交里只有：目录快照 + 作者/时间 + 说明 + 一个"父提交"指针。
   分支只是"我现在站在哪个提交上"的记号。
2. **"在 alpha 上提交" = 让 alpha 这张便签往前挪一格**，生成一个新提交。就这么回事。
3. **同一个提交可以被多个分支同时指着**（历史共享）。比如你从 `main` 新建一个分支、什么都不改，
   两个分支指向的就是**同一个提交**，此时它们没有"谁多谁少"。
4. **提交不会跨分支自动同步**。在 alpha 提交完，main 那边**一点变化都没有**，
   要让 main 也有，只能"合并（merge）"或"挑拣（cherry-pick）"。
   → 这就是"不同分支切换，commit 怎么算"的答案：**各算各的，分支之间不会自动搬运**。
5. **删除/回退只动便签，不动快照**。`git reset` 是把便签往回挪，快照还在硬盘上（
   只要没被垃圾回收），所以"切错分支""reset 错了"基本都能救回来（见第七节 reflog）。

### 2. 三个区域：工作区 / 暂存区 / 提交历史

```
工作区(你正在编辑的文件)  --git add-->  暂存区(index)  --git commit-->  提交历史
        ↑                                                            │
        └──────────── git checkout / switch（把某个提交的内容铺到工作区）┘
```

- **工作区**：你打开、编辑、保存的那些文件。
- **暂存区**：`git add` 之后"准备写进下一个提交"的内容。GitHub Desktop 左边勾选框 = 这个。
- **提交**：点 Commit 那一刻定格。
- **HEAD**：一个指针，指向"我现在在哪个分支上"。`git status` 里那句 `On branch alpha` 就是它。

### 3. 哪些文件"跟着分支走"，哪些不跟

| 类别 | 切分支时会怎样 | 说明 |
|---|---|---|
| 被 Git 跟踪的文件（源码、README、`.gitignore`、`package.json`…） | **整体换成目标分支的版本** | 包括 `.gitignore` 本身！所以同一个截图目录在 alpha 被忽略、切到 main 就变成"未跟踪文件" |
| 未提交的改动（已改但没 commit） | 尽量**带过去**；如果和目标分支冲突，Git 会**拒绝切换**并报错 | 这是 Git 少数会"拦你"的情况 |
| 未跟踪文件（untracked，从没 add 过） | **原地不动**，不属于任何分支 | 比如 `tests/e2e/shots-v042/` 里的截图 |
| 被忽略的文件（`node_modules/`、`out/`、`dist/`、`data/`） | **原地不动**，Git 完全不碰 | ⚠ 但它们可能是"另一个分支的产物"，见第六节 |

> **为什么切到 main"没有提示"？**
> Git 只在"会丢东西"时才拦人 —— 也就是"有未提交改动、且这些改动和目标分支的文件冲突"。
> 工作区干净时切换是**完全正常且零风险**的操作，所以它不提示。
> 想让自己有提示，就养成习惯：**切之前先 `git status`（GitHub Desktop = 看左边有没有勾选项/改动）**。
> 干净 = 随便切；不干净 = 先 commit（推荐）或 stash。

---

## 二、本仓库的分支约定（重要）

| 分支 | 角色 | 谁能动 |
|---|---|---|
| `main` | **稳定发布线**：只放"能发出去的版本"。打 exe、发版都基于它 | 由你决定何时把 alpha 合过来；**AI 不碰** |
| `alpha` | **开发线**：所有日常开发、每一轮的提交都在这里 | 开发就切到它 |
| `backup-v042`、`rescue-wip` | 历史事故时留下的快照分支 | 只读保留，确认不要了可以删 |

**工作流（约定）**：
1. 开发 → `alpha`；每完成一轮 → 在 alpha 上 **commit 一次**（不 push、不打 tag）。
2. 你自己确认 alpha 表现 OK → 用 GitHub Desktop 把 alpha **合并到 main**（或直接发给用户/打包）。
3. `main` 只在"要发版"时前进。永远不要在 main 上直接改代码再提交 —— 否则开发提交会混进稳定线。

**"领先/落后多少"怎么看**（这就是 commit 的"账本"）：

```bash
git log --oneline main..alpha   # alpha 比 main 多出来的提交（= 还没进稳定线的东西）
git log --oneline alpha..main   # main 比 alpha 多出来的（正常应为空）
git log --oneline --graph --all --decorate   # 一张图看清所有分支怎么分叉的
```

本节的当前实例：`main..alpha` 有 6 条（0e0744d、c3418c6、c13f60c、06f019d、0703e62、a92718f）。

---

## 三、日常动作速查（命令 ↔ GitHub Desktop）

| 想干什么 | 命令 | GitHub Desktop |
|---|---|---|
| 看我在哪、干不干净 | `git status` | 顶部 Current Branch + 左侧改动列表 |
| 看所有分支 | `git branch -vv` | 顶部 Current Branch → 下拉列表 |
| 切分支 | `git switch alpha`（旧写法 `git checkout alpha`） | 下拉列表 → 点分支名 → Switch |
| 新建分支并切过去 | `git switch -c 新名字` | 下拉列表 → New Branch |
| 提交 | `git add -A` + `git commit -m "说明"` | 勾选改动 → 填 Summary → Commit |
| 看历史 | `git log --oneline -10` | History 页 |
| 看某次提交改了什么 | `git show <hash>` | History → 点那次提交 |
| 看某文件逐行谁改的 | `git blame 文件` | （桌面版没有，用命令行） |

**切分支的完整安全动作（记住这 3 步）**：

```bash
git status                 # ① 确认干净（没有 modified / staged）
git switch alpha           # ② 切过去
git log --oneline -1       # ③ 确认 HEAD 落在预期的提交上
```

---

## 四、合并（merge）：把 alpha 的东西搬进 main

这是"多个分支如何运作"的核心操作。**合并永远发生在"你要接收改动的那个分支"上**：

```bash
git switch main            # ① 先站到"接收方"（main）
git merge alpha            # ② 把 alpha 的提交合并进来
git log --oneline -3       # ③ 看结果
```

合并有两种结果：

1. **快进（fast-forward）**：main 从没自己提交过，只是落后 → Git 直接把 main 便签挪到 alpha 的位置，
   **不产生新提交**，历史是一条直线。最常见的舒服情况。
2. **真合并（merge commit）**：两个分支**各自都有新提交**（分叉了）→ Git 需要一个新提交把两条历史接起来，
   会弹出编辑器让你写合并说明（默认 `Merge branch 'alpha'` 就行）。

**合并冲突（conflict）**：同一个文件的同一处，两边都改过 → Git 停下让你选。
GitHub Desktop 会让你在编辑器里处理，文件里会出现：

```
<<<<<<< HEAD            ← 当前分支（接收方）的版本
这里的代码
=======
那边的代码
>>>>>>> alpha           ← 要合进来的版本
```

手工把这段改成"你最终想要的样子"（**记得把 `<<<<<<<`、`=======`、`>>>>>>>` 三行标记全删掉**），
存盘 → `git add 文件` → `git commit`（或 GitHub Desktop 点 Continue Merge）。

> ⚠ 事故提醒：本仓库 2026-10-06 那次"v0.4.2 的活儿全没了"，根源就是
> **带着未提交改动切分支 + 在 GitHub Desktop 里点了 stash 的 Restore，弹出冲突后处于半途状态**。
> 那时的文件同时有"未合并（UU/DU）"标记，看着就像代码被删了。实际没丢，靠快照分支救回来的。
> 记住：**提交之后再切分支，就不会有这种场面**。

---

## 五、只挑一条提交：cherry-pick

只想把 alpha 上的**某一个提交**拿到 main（而不是全部）：

```bash
git switch main
git cherry-pick <hash>       # 把那条提交"复制"到 main（产生一个新的 hash）
```

用途：热修。比如你只想把"修打字错误"那条提交单独放到稳定线，不想带上实验性改动。

---

## 六、回退与"看起来丢了"的救法

### 1. 提交写了但还没提交完 / 只是不想现在提交

```bash
git stash                 # 把未提交改动收进抽屉（工作区变干净）
git stash list            # 看抽屉里有啥
git stash pop             # 拿出来（并从抽屉删掉）
git stash apply           # 拿出来（抽屉里留一份）
```

⚠ stash 是**全局抽屉**，不属于任何分支；带着改动切分支再 pop，很容易撞冲突。
**能用 commit 解决就别用 stash**（提交了可以随时 reset 回来，stash 撞了更绕）。

### 2. 撤销"最后一个提交"

```bash
git reset --soft HEAD~1   # 撤回提交，改动全部留在暂存区（最安全，等于"提交早了，我想重写说明"）
git reset HEAD~1          # 撤回提交，改动留在工作区（等于"提交早了，想再改改"）
git reset --hard HEAD~1   # ⚠ 撤回提交 + 丢掉改动（危险！只能靠 reflog 或快照分支救）
git revert <hash>         # 反向生成一条"抵消提交"（历史保留，适合已经 push/合并过的提交）
```

**口诀**：`--soft` / 默认（mixed）都只是把便签往回挪，**你的文件还在**；
`--hard` 才是真的把文件也退回去。

### 3. 救命工具：`git reflog`

它记录了 HEAD 每一次移动（切换、提交、reset 都记）。**几乎任何"操作失误导致的丢失"都能查回来**：

```bash
git reflog                    # 看最近 30 天的指针移动，找到"切走之前"那条的 hash
git switch -c 抢救 <hash>      # 从那个 hash 造个新分支站起来看
git branch --contains <hash>  # 这个提交现在被哪些分支包含（判断"它在哪个分支上"）
```

### 4. 切错分支了怎么办

```bash
git switch alpha              # 直接切回去，什么都不用做
```

**因为提交是快照、分支只是便签**：切走不会删东西，切回来就原样。
（唯一前提：切走时工作区是干净的，或者你的改动是未跟踪文件。）

---

## 七、本仓库的实际操作流程（照着做）

### 每天开始
```bash
cd E:\Develop\BlockCanvas
git switch alpha          # 确认在开发线（不是 main！）
git status                # 应该是干净的
git log --oneline -1      # 确认最新提交是你认识的
```

### 干完一轮
```bash
git status                        # 看看改了哪些
git add -A                        # 全部加入暂存
git commit -m "一句话说明这轮做了什么"
```

### 想看看 main 的旧版本长什么样（只读，看完就回来）
```bash
git switch main
# ……看一眼……
git switch alpha                  # 一定记得切回来！
```
> ⚠ 切到旧分支后，**跑测试前必须重新构建**：`out/`、`node_modules/` 是被忽略的，
> 切分支不会同步它们，直接跑就是"旧代码 + 新产物"的错觉。
> 稳妥做法：`git switch alpha && pnpm install --frozen-lockfile && pnpm build`。

### 要发布时
```bash
git switch main
git merge alpha           # 快进或产生合并提交
git log --oneline -3      # 确认
# 然后打 tag / 跑 build-exe.ps1（打包用）
```
本仓库约定：**AI 不擅自合并、不 push、不打 tag**，这几步由你决定。

---

## 八、几个容易搞混的问题（自问自答）

**Q：切到 main 之后，我在 alpha 上提交的东西还在吗？**
A：在。它属于 alpha 那条历史，main 看不到而已。切回 alpha 就都在。

**Q：我在 main 上改了半天代码、还 commit 了，怎么办？**
A：把那条提交"搬"到 alpha 上：
```bash
git switch main
git log --oneline -1              # 记下 hash
git switch alpha
git cherry-pick <hash>            # 搬到 alpha
git switch main
git reset --hard HEAD~1           # ⚠ 把 main 恢复成原样（改动已在 alpha 上，安全）
```

**Q：两个分支能同时改同一个文件吗？**
A：可以，各自提交互不影响，直到合并时才会要求你解决冲突（第四节）。

**Q：删除分支会不会删掉提交？**
A：`git branch -d 名字` 只是删掉便签。只要那些提交还被别的分支（或 tag、reflog）指着，就还在。
真正危险的是"便签删了 + 没人指着 + 垃圾回收跑过"，一般 30 天内都能 reflog 找回来。

**Q：`origin/alpha` 是什么？**
A：远程仓库里的 alpha 的**本地镜像**（上次 fetch/push 时的样子）。`git branch -vv` 里
`[origin/alpha]` 表示本地 alpha 与它同步；显示 `[ahead 2]` 表示你本地多 2 个还没推上去的提交。

**Q：push（推送）和 commit 什么关系？**
A：commit = 存到**本机**仓库；push = 把本机提交复制到**远程**（GitHub）。
本仓库现在只在本地提交，**没 push**，所以远程 main/alpha 还是旧的 —— 这是有意的（由你决定何时推）。

---

## 九、危险等级速查表

| 操作 | 危险度 | 备注 |
|---|---|---|
| `git status` / `git log` / `git diff` / `git show` / `git blame` | 安全 | 只读，随便用 |
| `git switch <分支>`（工作区干净时） | 安全 | 只是换文件和便签 |
| `git add` / `git commit` | 安全 | 只增不减 |
| `git stash` / `git stash pop` | 需小心 | 全局抽屉，撞冲突会很绕 |
| `git switch <分支>`（有未提交改动时） | 需小心 | 可能被拒，或把改动带过去 |
| `git merge` / `git cherry-pick` | 需小心 | 可能产生冲突，处理完才算完 |
| `git reset --soft/--mixed` | 较安全 | 只挪便签，文件还在 |
| `git reset --hard` | **危险** | 会丢未提交改动 |
| `git push --force` / `git clean -fd` / `git branch -D` | **危险** | 本仓库日常用不到 |

---

## 十、一句话总结

> **提交是一串不会变的快照，分支只是贴在某张快照上的便签。**
> 提交之后随便切分支都不会丢东西；切分支之前先 `git status` 确认干净；
> 分支之间不会自动搬运内容，要搬就 merge（全部）或 cherry-pick（单条）。
