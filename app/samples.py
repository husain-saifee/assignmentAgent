from typing import Any

from app.schemas import RubricCriterion, ScoringBand, StructuredRubric

SEED_ASSIGNMENTS: list[dict[str, Any]] = [
    {
        "id": "seed-python-lru-cache",
        "title": "CS301: O(1) LRU Cache Implementation (Python Code)",
        "assignment_type": "code",
        "prompt_text": (
            "Design and implement an `LRUCache` class in Python with a positive integer `capacity`.\n"
            "Requirements:\n"
            "1. `get(key: int) -> int`: Return the value of the key if it exists in the cache, "
            "otherwise return `-1`. Mark the accessed key as most recently used.\n"
            "2. `put(key: int, value: int) -> None`: Update the value of the key if present, or insert "
            "the key-value pair. If the cache exceeds `capacity`, evict the least recently used (LRU) key.\n"
            "3. Both `get` and `put` MUST run in $O(1)$ average time complexity using a hash map combined "
            "with a doubly linked list (or `collections.OrderedDict`), and handle edge cases such as "
            "`capacity == 1` and updating an existing key without evicting another key."
        ),
        "raw_rubric_text": (
            "Total: 100 points\n"
            "- C1: Data Structure & O(1) Time Complexity (40 pts): Uses hash map + doubly linked list "
            "(or OrderedDict) achieving true O(1) get/put instead of O(n) list scans.\n"
            "- C2: Eviction & Recency Update Logic (35 pts): Correctly moves accessed/updated keys to "
            "MRU position and evicts the true LRU key only when capacity is exceeded.\n"
            "- C3: Edge Cases & Code Quality (25 pts): Handles updating existing keys at full capacity "
            "without false eviction, handles capacity=1, and uses clean type annotations and structure."
        ),
        "reference_solution_text": (
            "class _Node:\n"
            "    __slots__ = ('key', 'val', 'prev', 'next')\n"
            "    def __init__(self, key: int = 0, val: int = 0) -> None:\n"
            "        self.key = key\n"
            "        self.val = val\n"
            "        self.prev: _Node | None = None\n"
            "        self.next: _Node | None = None\n\n"
            "class LRUCache:\n"
            "    def __init__(self, capacity: int) -> None:\n"
            "        self.capacity = capacity\n"
            "        self.cache: dict[int, _Node] = {}\n"
            "        self.head = _Node()\n"
            "        self.tail = _Node()\n"
            "        self.head.next = self.tail\n"
            "        self.tail.prev = self.head\n\n"
            "    def _remove(self, node: _Node) -> None:\n"
            "        prev_node, next_node = node.prev, node.next\n"
            "        assert prev_node is not None and next_node is not None\n"
            "        prev_node.next = next_node\n"
            "        next_node.prev = prev_node\n\n"
            "    def _add_to_mru(self, node: _Node) -> None:\n"
            "        prev_mru = self.tail.prev\n"
            "        assert prev_mru is not None\n"
            "        prev_mru.next = node\n"
            "        node.prev = prev_mru\n"
            "        node.next = self.tail\n"
            "        self.tail.prev = node\n\n"
            "    def get(self, key: int) -> int:\n"
            "        if key not in self.cache:\n"
            "            return -1\n"
            "        node = self.cache[key]\n"
            "        self._remove(node)\n"
            "        self._add_to_mru(node)\n"
            "        return node.val\n\n"
            "    def put(self, key: int, value: int) -> None:\n"
            "        if key in self.cache:\n"
            "            node = self.cache[key]\n"
            "            node.val = value\n"
            "            self._remove(node)\n"
            "            self._add_to_mru(node)\n"
            "            return\n"
            "        if len(self.cache) >= self.capacity:\n"
            "            lru = self.head.next\n"
            "            assert lru is not None and lru is not self.tail\n"
            "            self._remove(lru)\n"
            "            del self.cache[lru.key]\n"
            "        new_node = _Node(key, value)\n"
            "        self.cache[key] = new_node\n"
            "        self._add_to_mru(new_node)\n"
        ),
        "structured_rubric": StructuredRubric(
            rubric_title="CS301: O(1) LRU Cache Implementation Rubric",
            total_max_points=100.0,
            criteria=[
                RubricCriterion(
                    criterion_id="C1",
                    title="Data Structure & O(1) Time Complexity",
                    description=(
                        "Uses a hash map paired with a doubly linked list or OrderedDict so both "
                        "get() and put() operate in O(1) average time."
                    ),
                    max_points=40.0,
                    evaluation_focus="code_logic",
                    scoring_bands=[
                        ScoringBand(
                            band_label="Exemplary",
                            points_range="36-40",
                            description="True O(1) get and put using hash map + doubly linked list or OrderedDict.",
                        ),
                        ScoringBand(
                            band_label="Proficient",
                            points_range="25-35",
                            description="Uses dict + list with O(n) removal on recency updates.",
                        ),
                        ScoringBand(
                            band_label="Developing",
                            points_range="10-24",
                            description="Uses linear structures or broken pointer manipulation.",
                        ),
                        ScoringBand(
                            band_label="Unsatisfactory",
                            points_range="0-9",
                            description="Does not implement a working cache lookup structure.",
                        ),
                    ],
                ),
                RubricCriterion(
                    criterion_id="C2",
                    title="Eviction & Recency Update Logic",
                    description=(
                        "Updates key recency on both get() and put(), and evicts the least recently "
                        "used item when capacity is exceeded."
                    ),
                    max_points=35.0,
                    evaluation_focus="code_logic",
                    scoring_bands=[
                        ScoringBand(
                            band_label="Exemplary",
                            points_range="31-35",
                            description="Both get() and put() refresh recency accurately and evict true LRU.",
                        ),
                        ScoringBand(
                            band_label="Proficient",
                            points_range="20-30",
                            description="Evicts oldest item but forgets to refresh recency on get() or existing put().",
                        ),
                        ScoringBand(
                            band_label="Developing",
                            points_range="8-19",
                            description="FIFO eviction or off-by-one capacity checks.",
                        ),
                        ScoringBand(
                            band_label="Unsatisfactory",
                            points_range="0-7",
                            description="No eviction logic implemented.",
                        ),
                    ],
                ),
                RubricCriterion(
                    criterion_id="C3",
                    title="Edge Cases & Code Quality",
                    description=(
                        "Correctly handles updating an existing key when cache is at full capacity "
                        "without evicting another key, handles capacity=1, and maintains clean code style."
                    ),
                    max_points=25.0,
                    evaluation_focus="code_quality",
                    scoring_bands=[
                        ScoringBand(
                            band_label="Exemplary",
                            points_range="22-25",
                            description="Handles existing-key updates at capacity, capacity=1, and clean modular Python.",
                        ),
                        ScoringBand(
                            band_label="Proficient",
                            points_range="14-21",
                            description="Minor bug when updating an existing key at full capacity; readable code.",
                        ),
                        ScoringBand(
                            band_label="Developing",
                            points_range="6-13",
                            description="Multiple unhandled edge cases or poor readability.",
                        ),
                        ScoringBand(
                            band_label="Unsatisfactory",
                            points_range="0-5",
                            description="Syntax errors or crashes on standard inputs.",
                        ),
                    ],
                ),
            ],
        ),
        "sample_submission": {
            "student_name": "Jordan Patel",
            "student_id": "STU-4082",
            "submission_filename": "lru_cache_submission.py",
            "submission_text": (
                "class LRUCache:\n"
                "    def __init__(self, capacity: int):\n"
                "        self.capacity = capacity\n"
                "        self.store = {}\n"
                "        self.order = []  # tracks keys from LRU (index 0) to MRU (end)\n\n"
                "    def get(self, key: int) -> int:\n"
                "        if key not in self.store:\n"
                "            return -1\n"
                "        # Move key to most recently used\n"
                "        self.order.remove(key)\n"
                "        self.order.append(key)\n"
                "        return self.store[key]\n\n"
                "    def put(self, key: int, value: int) -> None:\n"
                "        if len(self.store) >= self.capacity:\n"
                "            oldest = self.order.pop(0)\n"
                "            del self.store[oldest]\n"
                "        self.store[key] = value\n"
                "        if key in self.order:\n"
                "            self.order.remove(key)\n"
                "        self.order.append(key)\n"
            ),
        },
    },
    {
        "id": "seed-theory-distributed-attention",
        "title": "CS450: Transformer Self-Attention & Distributed Training (Theory)",
        "assignment_type": "theory",
        "prompt_text": (
            "Answer the following three theoretical questions rigorously:\n"
            "1. **Scaled Dot-Product Attention**: Write the mathematical formulation of Scaled "
            "Dot-Product Attention and explain why scaling by $1/\\sqrt{d_k}$ is necessary for "
            "gradient stability during backpropagation.\n"
            "2. **Complexity & FlashAttention**: Analyze the time and memory complexity of standard "
            "self-attention with respect to sequence length $N$ and head dimension $d_k$, and explain "
            "how IO-aware tiling (FlashAttention) reduces HBM memory accesses without approximation.\n"
            "3. **Distributed Data vs. Tensor Parallelism**: Compare Data Parallelism (DDP/FSDP) "
            "and Tensor Model Parallelism when training a 70B-parameter Transformer across multi-node GPUs, "
            "highlighting communication collectives (`AllReduce`, `AllGather`, `ReduceScatter`) and bandwidth constraints."
        ),
        "raw_rubric_text": (
            "Total: 100 points\n"
            "- C1: Scaled Dot-Product Formulation & Variance Proof (35 pts): Exact equation "
            "softmax(QK^T / sqrt(d_k))V and variance analysis showing dot products grow as O(d_k), "
            "pushing softmax into vanishing-gradient saturation without 1/sqrt(d_k).\n"
            "- C2: Quadratic Memory Bottleneck & IO-Aware Tiling (35 pts): Identifies O(N^2 d_k) time "
            "and O(N^2) activation memory; explains SRAM tiling and online softmax rescaling in FlashAttention.\n"
            "- C3: Distributed Parallelism & Collective Tradeoffs (30 pts): Accurately contrasts DDP/FSDP "
            "vs Tensor Parallelism, collective operations, and NVLink vs inter-node interconnect constraints."
        ),
        "reference_solution_text": (
            "1. Attention(Q, K, V) = softmax((Q K^T) / sqrt(d_k)) V. If components of q and k are "
            "independent random variables with mean 0 and variance 1, their dot product has mean 0 "
            "and variance d_k. For large d_k, logits grow large in magnitude, pushing softmax into "
            "regions with near-zero gradients. Dividing by sqrt(d_k) restores unit variance.\n"
            "2. Standard attention takes O(N^2 d_k) FLOPs and materializes the N x N attention matrix "
            "in HBM (O(N^2) memory). FlashAttention tiles Q, K, V into on-chip SRAM blocks and uses "
            "online softmax normalization (tracking running max m and sum l) to compute exact attention "
            "without materializing the N x N matrix in HBM.\n"
            "3. DDP replicates weights and runs AllReduce on gradients; FSDP/ZeRO-3 shards parameters, "
            "gradients, and optimizer states using AllGather (forward/backward) and ReduceScatter (gradients). "
            "Tensor Parallelism splits individual weight matrices across GPUs within a node, requiring "
            "per-layer AllReduce/AllGather syncs that demand high-bandwidth NVLink intra-node interconnects."
        ),
        "structured_rubric": StructuredRubric(
            rubric_title="CS450: Transformer Attention & Distributed Systems Rubric",
            total_max_points=100.0,
            criteria=[
                RubricCriterion(
                    criterion_id="C1",
                    title="Scaled Dot-Product Formulation & Gradient Stability",
                    description=(
                        "States the exact equation softmax(QK^T / sqrt(d_k))V and explains how "
                        "dot-product variance grows as O(d_k), causing softmax saturation and vanishing gradients."
                    ),
                    max_points=35.0,
                    evaluation_focus="theory_concept",
                    scoring_bands=[
                        ScoringBand(
                            band_label="Exemplary",
                            points_range="31-35",
                            description="Exact formula plus statistical variance derivation and softmax Jacobian explanation.",
                        ),
                        ScoringBand(
                            band_label="Proficient",
                            points_range="22-30",
                            description="Correct formula and mentions softmax saturation, but omits variance scaling proof.",
                        ),
                        ScoringBand(
                            band_label="Developing",
                            points_range="10-21",
                            description="Formula partially correct or vague explanation of numerical overflow.",
                        ),
                        ScoringBand(
                            band_label="Unsatisfactory",
                            points_range="0-9",
                            description="Incorrect attention formula or missing explanation.",
                        ),
                    ],
                ),
                RubricCriterion(
                    criterion_id="C2",
                    title="Quadratic Complexity & FlashAttention IO-Awareness",
                    description=(
                        "Analyzes O(N^2 d_k) compute and O(N^2) HBM memory, and explains SRAM block "
                        "tiling with online softmax rescaling."
                    ),
                    max_points=35.0,
                    evaluation_focus="theory_concept",
                    scoring_bands=[
                        ScoringBand(
                            band_label="Exemplary",
                            points_range="31-35",
                            description="Distinguishes compute vs HBM memory and explains SRAM tiling + online softmax.",
                        ),
                        ScoringBand(
                            band_label="Proficient",
                            points_range="22-30",
                            description="Identifies O(N^2) bottleneck and GPU cache tiling, but misses online softmax mechanics.",
                        ),
                        ScoringBand(
                            band_label="Developing",
                            points_range="10-21",
                            description="Mentions O(N^2) time complexity only; confuses FlashAttention with sparse approximation.",
                        ),
                        ScoringBand(
                            band_label="Unsatisfactory",
                            points_range="0-9",
                            description="Incorrect complexity analysis.",
                        ),
                    ],
                ),
                RubricCriterion(
                    criterion_id="C3",
                    title="Distributed Parallelism & Collective Tradeoffs",
                    description=(
                        "Compares DDP/FSDP and Tensor Parallelism for a 70B model, citing collectives "
                        "(AllReduce, AllGather, ReduceScatter) and intra-node NVLink vs inter-node bandwidth."
                    ),
                    max_points=30.0,
                    evaluation_focus="completeness",
                    scoring_bands=[
                        ScoringBand(
                            band_label="Exemplary",
                            points_range="26-30",
                            description="Thorough comparison of sharding, collective ops, and hardware interconnect limits.",
                        ),
                        ScoringBand(
                            band_label="Proficient",
                            points_range="18-25",
                            description="Explains data vs tensor parallelism conceptually but omits specific collectives.",
                        ),
                        ScoringBand(
                            band_label="Developing",
                            points_range="8-17",
                            description="Superficial comparison of splitting data vs splitting layers.",
                        ),
                        ScoringBand(
                            band_label="Unsatisfactory",
                            points_range="0-7",
                            description="Missing or fundamentally confused distributed training discussion.",
                        ),
                    ],
                ),
            ],
        ),
        "sample_submission": {
            "student_name": "Elena Rostova",
            "student_id": "STU-9154",
            "submission_filename": "attention_and_distributed_essay.md",
            "submission_text": (
                "# CS450 Written Assignment\n\n"
                "## 1. Scaled Dot-Product Attention\n"
                "The attention equation is:\n"
                "$$\\text{Attention}(Q, K, V) = \\text{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V$$\n"
                "When the dimension $d_k$ is large, the dot product between query and key vectors produces "
                "large numbers. If the inputs to softmax are very large, softmax pushes the largest value "
                "close to 1 and all others close to 0, where the gradient of softmax becomes extremely small "
                "(vanishing gradients). Scaling by $\\sqrt{d_k}$ keeps the logits in a reasonable range.\n\n"
                "## 2. Complexity & FlashAttention\n"
                "Standard self-attention has $O(N^2)$ time and memory complexity because multiplying $Q$ "
                "and $K^T$ creates an $N \\times N$ matrix. FlashAttention speeds this up by breaking the "
                "inputs into smaller blocks that fit in fast GPU SRAM cache so it does not have to write "
                "the full $N \\times N$ attention matrix out to slow GPU main memory (HBM).\n\n"
                "## 3. Distributed Data vs. Tensor Parallelism\n"
                "In Data Parallelism, each GPU gets a different batch of training data and a copy of the "
                "model, and GPUs average their gradients at the end of each step. However, a 70B model "
                "cannot fit on a single GPU's memory using standard DDP. Tensor Parallelism splits the "
                "actual weight matrices across multiple GPUs so they compute parts of each layer in parallel, "
                "which requires very fast communication between GPUs inside the same server."
            ),
        },
    },
]
