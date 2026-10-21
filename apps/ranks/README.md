# distillate-ranks

Records, once a day, where distillate ranks in npm and GitHub search and how many weekly downloads each package has. It's the baseline for the search discoverability work (milestone 26).

- **Queries:** `QUERIES` in `src/ranks.ts`, each structure's search name plus three broad ones.
- **Packages:** `TRACKED`, a fixed list, so a package records its absence before it's published.
- **Repo:** `akshay-xp/distillate`, in GitHub repository search.
- **Depth:** ranks run 1 to 250; past that, or absent, the rank is empty.

## Data

`.github/workflows/ranks.yml` runs `track` daily and appends to `ranks.csv` on the `ranks` branch, which holds nothing else. main gets no commits from it.

```
date,source,query,name,rank,score,downloads
```

| source      | one row per               | rank                                     | score               | downloads                                             |
| ----------- | ------------------------- | ---------------------------------------- | ------------------- | ----------------------------------------------------- |
| `npm`       | query and tracked package | position in npm search                   | npm's `score.final` | weekly, from the search result                        |
| `github`    | query                     | the repo's position in repository search | empty               | empty                                                 |
| `downloads` | tracked package           | empty                                    | empty               | last week, from `api.npmjs.org`; empty before publish |

Read it with `git show origin/ranks:ranks.csv`.

## Run locally

```sh
GITHUB_TOKEN="$(gh auth token)" pnpm --filter distillate-ranks track /path/to/ranks.csv
```

Without a token, GitHub allows 10 searches a minute, so the run is slower and may hit the limit.
