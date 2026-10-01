# Tournament results

8 titans, seeds 1, up to 240 s a match, 56 matches, 10 at once. Took 1301 s.

## Ranking

1 point for a win, 0.5 for a draw (time running out with both main cores alive is a draw). Ranked by points, then wins, then share kept: its starting parts still alive at the end (leaving out those that ended themselves), averaged over its matches.

| # | titan | played | wins | draws | losses | points | share kept | match length |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | titan-juggernaut | 14 | 13 | 1 | 0 | 13.5 | 98.6% | 75 s |
| 2 | titan-anvil | 14 | 10 | 3 | 1 | 11.5 | 95.0% | 89 s |
| 3 | titan-palisade | 14 | 10 | 0 | 4 | 10 | 72.3% | 62 s |
| 4 | titan-shatter | 14 | 5 | 2 | 7 | 6 | 44.2% | 91 s |
| 5 | titan-woodpecker | 14 | 3 | 5 | 6 | 5.5 | 41.9% | 112 s |
| 6 | titan-mirage | 14 | 2 | 6 | 6 | 5 | 64.3% | 145 s |
| 7 | titan-bastion | 14 | 2 | 5 | 7 | 4.5 | 65.6% | 119 s |
| 8 | titan-hive | 14 | 0 | 0 | 14 | 0 | 58.0% | 39 s |

## Pair by pair

Wins, draws, and losses of the titan on the left against the titan on top, over every seed and both sides.

|  | titan-hive | titan-bastion | titan-juggernaut | titan-woodpecker | titan-palisade | titan-mirage | titan-shatter | titan-anvil |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| titan-hive |  | 0-0-2 | 0-0-2 | 0-0-2 | 0-0-2 | 0-0-2 | 0-0-2 | 0-0-2 |
| titan-bastion | 2-0-0 |  | 0-0-2 | 0-2-0 | 0-0-2 | 0-2-0 | 0-1-1 | 0-0-2 |
| titan-juggernaut | 2-0-0 | 2-0-0 |  | 2-0-0 | 2-0-0 | 2-0-0 | 2-0-0 | 1-1-0 |
| titan-woodpecker | 2-0-0 | 0-2-0 | 0-0-2 |  | 0-0-2 | 0-2-0 | 1-1-0 | 0-0-2 |
| titan-palisade | 2-0-0 | 2-0-0 | 0-0-2 | 2-0-0 |  | 2-0-0 | 2-0-0 | 0-0-2 |
| titan-mirage | 2-0-0 | 0-2-0 | 0-0-2 | 0-2-0 | 0-0-2 |  | 0-0-2 | 0-2-0 |
| titan-shatter | 2-0-0 | 1-1-0 | 0-0-2 | 0-1-1 | 0-0-2 | 2-0-0 |  | 0-0-2 |
| titan-anvil | 2-0-0 | 2-0-0 | 0-1-1 | 2-0-0 | 2-0-0 | 0-2-0 | 2-0-0 |  |

## Speed check

Each titan against a copy of itself (seed 1), run alone before the matches. The rule: average at most 16 ms per tick. A 95th percentile over 33 ms is a warning only.

| titan | average ms | 95th ms | worst ms | scripts ms | rest ms | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| titan-hive | 11.60 | 25.44 | 489.49 | 4.24 | 7.35 | ok |
| titan-bastion | 6.75 | 14.42 | 50.31 | 2.47 | 4.28 | ok |
| titan-juggernaut | 13.87 | 21.48 | 146.94 | 4.42 | 9.46 | ok |
| titan-woodpecker | 17.07 | 54.77 | 133.52 | 8.24 | 8.83 | TOO SLOW: average 17.1 ms is over 16 |
| titan-palisade | 13.32 | 23.28 | 140.44 | 7.10 | 6.23 | ok |
| titan-mirage | 5.34 | 11.07 | 61.32 | 1.90 | 3.44 | ok |
| titan-shatter | 26.72 | 54.46 | 224.44 | 13.85 | 12.87 | TOO SLOW: average 26.7 ms is over 16 |
| titan-anvil | 5.54 | 7.37 | 93.98 | 1.78 | 3.75 | ok |

## What beat it

### titan-hive

- titan-bastion: lost 2 of 2 (its main core destroyed in 2, at 68 s on average; it had 43.9% of its parts left, the winner 97.5%)
- titan-juggernaut: lost 2 of 2 (its main core destroyed in 2, at 42 s on average; it had 13.9% of its parts left, the winner 98.8%)
- titan-woodpecker: lost 2 of 2 (its main core destroyed in 2, at 10 s on average; it had 93.2% of its parts left, the winner 96.5%)
- titan-palisade: lost 2 of 2 (its main core destroyed in 2, at 23 s on average; it had 52.9% of its parts left, the winner 99.6%)
- titan-mirage: lost 2 of 2 (its main core destroyed in 2, at 17 s on average; it had 86.6% of its parts left, the winner 100.0%)
- titan-shatter: lost 2 of 2 (its main core destroyed in 2, at 72 s on average; it had 80.0% of its parts left, the winner 60.8%)
- titan-anvil: lost 2 of 2 (its main core destroyed in 1, at 18 s on average; it had 0.0% of its parts left, the winner 99.6%; out of bounds in 1, at 37 s on average; it had 70.7% of its parts left, the winner 99.4%)

### titan-bastion

- titan-juggernaut: lost 2 of 2 (its main core destroyed in 2, at 40 s on average; it had 71.7% of its parts left, the winner 98.9%)
- titan-palisade: lost 2 of 2 (its main core destroyed in 2, at 65 s on average; it had 93.0% of its parts left, the winner 99.6%)
- titan-shatter: lost 1 of 2 (its main core destroyed in 1, at 48 s on average; it had 95.8% of its parts left, the winner 57.9%)
- titan-anvil: lost 2 of 2 (its main core destroyed in 2, at 31 s on average; it had 97.7% of its parts left, the winner 94.5%)
- drew with: titan-woodpecker (2 of 2), titan-mirage (2 of 2), titan-shatter (1 of 2)

### titan-juggernaut

- nothing beat it
- drew with: titan-anvil (1 of 2)

### titan-woodpecker

- titan-juggernaut: lost 2 of 2 (its main core destroyed in 2, at 41 s on average; it had 0.4% of its parts left, the winner 97.2%)
- titan-palisade: lost 2 of 2 (its main core destroyed in 2, at 69 s on average; it had 30.6% of its parts left, the winner 50.8%)
- titan-anvil: lost 2 of 2 (its main core destroyed in 1, at 33 s on average; it had 63.5% of its parts left, the winner 99.6%; out of bounds in 1, at 36 s on average; it had 64.4% of its parts left, the winner 99.7%)
- drew with: titan-bastion (2 of 2), titan-mirage (2 of 2), titan-shatter (1 of 2)

### titan-palisade

- titan-juggernaut: lost 2 of 2 (its main core destroyed in 1, at 63 s on average; it had 62.4% of its parts left, the winner 97.9%; out of bounds in 1, at 63 s on average; it had 62.4% of its parts left, the winner 97.8%)
- titan-anvil: lost 2 of 2 (out of bounds in 2, at 38 s on average; it had 83.8% of its parts left, the winner 97.1%)

### titan-mirage

- titan-juggernaut: lost 2 of 2 (its main core destroyed in 2, at 85 s on average; it had 11.8% of its parts left, the winner 98.5%)
- titan-palisade: lost 2 of 2 (its main core destroyed in 1, at 93 s on average; it had 36.5% of its parts left, the winner 51.0%; out of bounds in 1, at 84 s on average; it had 50.6% of its parts left, the winner 64.1%)
- titan-shatter: lost 2 of 2 (its main core destroyed in 2, at 97 s on average; it had 48.3% of its parts left, the winner 58.0%)
- drew with: titan-bastion (2 of 2), titan-woodpecker (2 of 2), titan-anvil (2 of 2)

### titan-shatter

- titan-juggernaut: lost 2 of 2 (its main core destroyed in 2, at 48 s on average; it had 40.6% of its parts left, the winner 99.4%)
- titan-woodpecker: lost 1 of 2 (its main core destroyed in 1, at 47 s on average; it had 36.3% of its parts left, the winner 65.7%)
- titan-palisade: lost 2 of 2 (its main core destroyed in 2, at 70 s on average; it had 5.8% of its parts left, the winner 52.6%)
- titan-anvil: lost 2 of 2 (its main core destroyed in 2, at 48 s on average; it had 53.1% of its parts left, the winner 97.4%)
- drew with: titan-bastion (1 of 2), titan-woodpecker (1 of 2)

### titan-anvil

- titan-juggernaut: lost 1 of 2 (its main core destroyed in 1, at 145 s on average; it had 57.1% of its parts left, the winner 99.6%)
- drew with: titan-juggernaut (1 of 2), titan-mirage (2 of 2)
