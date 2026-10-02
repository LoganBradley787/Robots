# Tournament results

8 titans, seeds 1, 2, 3, up to 240 s a match, 168 matches, 10 at once. Took 3264 s.

## Ranking

1 point for a win, 0.5 for a draw (time running out with both main cores alive is a draw). Ranked by points, then wins, then share kept: its starting parts still alive at the end (leaving out those that ended themselves), averaged over its matches.

| # | titan | played | wins | draws | losses | points | share kept | match length |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | titan-juggernaut | 42 | 27 | 14 | 1 | 34 | 94.4% | 125 s |
| 2 | titan-palisade | 42 | 22 | 10 | 10 | 27 | 81.8% | 131 s |
| 3 | titan-bastion | 42 | 10 | 31 | 1 | 25.5 | 96.6% | 194 s |
| 4 | titan-anvil | 42 | 16 | 16 | 10 | 24 | 96.1% | 153 s |
| 5 | titan-mirage | 42 | 10 | 15 | 17 | 17.5 | 90.8% | 128 s |
| 6 | titan-hive | 42 | 6 | 23 | 13 | 17.5 | 88.8% | 173 s |
| 7 | titan-shatter | 42 | 0 | 25 | 17 | 12.5 | 27.4% | 170 s |
| 8 | titan-woodpecker | 42 | 2 | 16 | 24 | 10 | 65.7% | 119 s |

## Pair by pair

Wins, draws, and losses of the titan on the left against the titan on top, over every seed and both sides.

|  | titan-hive | titan-bastion | titan-juggernaut | titan-woodpecker | titan-palisade | titan-mirage | titan-shatter | titan-anvil |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| titan-hive |  | 0-5-1 | 0-2-4 | 6-0-0 | 0-1-5 | 0-4-2 | 0-6-0 | 0-5-1 |
| titan-bastion | 1-5-0 |  | 0-6-0 | 6-0-0 | 0-6-0 | 3-2-1 | 0-6-0 | 0-6-0 |
| titan-juggernaut | 4-2-0 | 0-6-0 |  | 0-6-0 | 6-0-0 | 6-0-0 | 6-0-0 | 5-0-1 |
| titan-woodpecker | 0-0-6 | 0-0-6 | 0-6-0 |  | 0-0-6 | 0-0-6 | 0-6-0 | 2-4-0 |
| titan-palisade | 5-1-0 | 0-6-0 | 0-0-6 | 6-0-0 |  | 2-3-1 | 6-0-0 | 3-0-3 |
| titan-mirage | 2-4-0 | 1-2-3 | 0-0-6 | 6-0-0 | 1-3-2 |  | 0-6-0 | 0-0-6 |
| titan-shatter | 0-6-0 | 0-6-0 | 0-0-6 | 0-6-0 | 0-0-6 | 0-6-0 |  | 0-1-5 |
| titan-anvil | 1-5-0 | 0-6-0 | 1-0-5 | 0-4-2 | 3-0-3 | 6-0-0 | 5-1-0 |  |

## Speed check

Each titan against a copy of itself (seed 1), run alone before the matches. The rule: average at most 16 ms per tick. A 95th percentile over 33 ms is a warning only.

| titan | average ms | 95th ms | worst ms | scripts ms | rest ms | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| titan-hive | 9.48 | 19.10 | 45.62 | 3.25 | 6.23 | ok |
| titan-bastion | 10.24 | 23.25 | 99.32 | 3.11 | 7.14 | ok |
| titan-juggernaut | 10.73 | 11.54 | 128.77 | 4.19 | 6.54 | ok |
| titan-woodpecker | 8.36 | 16.55 | 44.58 | 3.35 | 5.02 | ok |
| titan-palisade | 10.64 | 13.98 | 117.36 | 5.71 | 4.93 | ok |
| titan-mirage | 6.42 | 10.74 | 84.31 | 1.50 | 4.92 | ok |
| titan-shatter | 11.97 | 21.93 | 145.50 | 6.43 | 5.54 | ok |
| titan-anvil | 8.69 | 11.28 | 84.31 | 2.18 | 6.51 | ok |

## What beat it

### titan-hive

- titan-bastion: lost 1 of 6 (its main core destroyed in 1, at 80 s on average; it had 66.1% of its parts left, the winner 100.0%)
- titan-juggernaut: lost 4 of 6 (out of bounds in 4, at 98 s on average; it had 92.0% of its parts left, the winner 98.5%)
- titan-palisade: lost 5 of 6 (its main core destroyed in 4, at 145 s on average; it had 65.9% of its parts left, the winner 97.1%; out of bounds in 1, at 134 s on average; it had 50.8% of its parts left, the winner 91.4%)
- titan-mirage: lost 2 of 6 (its main core destroyed in 2, at 67 s on average; it had 84.5% of its parts left, the winner 100.0%)
- titan-anvil: lost 1 of 6 (out of bounds in 1, at 174 s on average; it had 87.0% of its parts left, the winner 94.4%)
- drew with: titan-bastion (5 of 6), titan-juggernaut (2 of 6), titan-palisade (1 of 6), titan-mirage (4 of 6), titan-shatter (6 of 6), titan-anvil (5 of 6)

### titan-bastion

- titan-mirage: lost 1 of 6 (its main core destroyed in 1, at 109 s on average; it had 90.6% of its parts left, the winner 89.1%)
- drew with: titan-hive (5 of 6), titan-juggernaut (6 of 6), titan-palisade (6 of 6), titan-mirage (2 of 6), titan-shatter (6 of 6), titan-anvil (6 of 6)

### titan-juggernaut

- titan-anvil: lost 1 of 6 (out of bounds in 1, at 200 s on average; it had 92.6% of its parts left, the winner 98.3%)
- drew with: titan-hive (2 of 6), titan-bastion (6 of 6), titan-woodpecker (6 of 6)

### titan-woodpecker

- titan-hive: lost 6 of 6 (its main core destroyed in 6, at 36 s on average; it had 69.5% of its parts left, the winner 100.0%)
- titan-bastion: lost 6 of 6 (its main core destroyed in 6, at 26 s on average; it had 68.8% of its parts left, the winner 96.9%)
- titan-palisade: lost 6 of 6 (its main core destroyed in 6, at 59 s on average; it had 65.8% of its parts left, the winner 94.3%)
- titan-mirage: lost 6 of 6 (its main core destroyed in 6, at 18 s on average; it had 68.2% of its parts left, the winner 100.0%)
- drew with: titan-juggernaut (6 of 6), titan-shatter (6 of 6), titan-anvil (4 of 6)

### titan-palisade

- titan-juggernaut: lost 6 of 6 (out of bounds in 6, at 34 s on average; it had 34.1% of its parts left, the winner 99.7%)
- titan-mirage: lost 1 of 6 (its main core destroyed in 1, at 130 s on average; it had 64.1% of its parts left, the winner 98.4%)
- titan-anvil: lost 3 of 6 (out of bounds in 3, at 70 s on average; it had 92.7% of its parts left, the winner 96.4%)
- drew with: titan-hive (1 of 6), titan-bastion (6 of 6), titan-mirage (3 of 6)

### titan-mirage

- titan-bastion: lost 3 of 6 (out of bounds in 3, at 118 s on average; it had 70.6% of its parts left, the winner 94.3%)
- titan-juggernaut: lost 6 of 6 (out of bounds in 6, at 44 s on average; it had 99.4% of its parts left, the winner 97.9%)
- titan-palisade: lost 2 of 6 (its main core destroyed in 1, at 226 s on average; it had 44.7% of its parts left, the winner 80.2%; out of bounds in 1, at 219 s on average; it had 55.1% of its parts left, the winner 89.0%)
- titan-anvil: lost 6 of 6 (out of bounds in 6, at 26 s on average; it had 93.5% of its parts left, the winner 100.0%)
- drew with: titan-hive (4 of 6), titan-bastion (2 of 6), titan-palisade (3 of 6), titan-shatter (6 of 6)

### titan-shatter

- titan-juggernaut: lost 6 of 6 (out of bounds in 6, at 41 s on average; it had 27.2% of its parts left, the winner 99.9%)
- titan-palisade: lost 6 of 6 (its main core destroyed in 6, at 72 s on average; it had 10.3% of its parts left, the winner 96.7%)
- titan-anvil: lost 5 of 6 (its main core destroyed in 3, at 57 s on average; it had 31.8% of its parts left, the winner 98.8%; out of bounds in 2, at 119 s on average; it had 15.9% of its parts left, the winner 98.4%)
- drew with: titan-hive (6 of 6), titan-bastion (6 of 6), titan-woodpecker (6 of 6), titan-mirage (6 of 6), titan-anvil (1 of 6)

### titan-anvil

- titan-juggernaut: lost 5 of 6 (out of bounds in 5, at 108 s on average; it had 99.2% of its parts left, the winner 92.7%)
- titan-woodpecker: lost 2 of 6 (its main core destroyed in 1, at 187 s on average; it had 88.2% of its parts left, the winner 63.1%; out of bounds in 1, at 91 s on average; it had 92.4% of its parts left, the winner 63.7%)
- titan-palisade: lost 3 of 6 (its main core destroyed in 3, at 189 s on average; it had 80.2% of its parts left, the winner 90.8%)
- drew with: titan-hive (5 of 6), titan-bastion (6 of 6), titan-woodpecker (4 of 6), titan-shatter (1 of 6)
