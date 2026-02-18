# Local LLM Research: Ollama + AMD RX 7900 XTX

*Researched 2026-02-17 after Thomas's ADHD-powered late-night idea 😄*

## TL;DR
**Ja, det er absolut værd at teste.** Din 7900 XTX er en af de bedste consumer GPUs til local LLMs. Men WSL2 + AMD = problematisk — Windows native Ollama er bedste vej.

## Din Hardware
- **GPU:** AMD RX 7900 XTX (24GB VRAM) — officielt supported af Ollama via ROCm
- **CPU:** Intel i7-8700K
- **OS:** Windows + WSL2

## Performance Benchmarks (7900 XTX, community data)

| Model | Kvantisering | Tok/s | Passer i 24GB? |
|-------|-------------|-------|-----------------|
| Llama 3.1 8B | Q4 | ~94 | ✅ Nemt (5GB) |
| Llama 3.1 8B | FP16 | ~45 | ✅ (16GB) |
| Llama 3.1 8B | Q8 | ~67 | ✅ (9GB) |
| DeepSeek R1 32B | Q4 | ~24 | ✅ (19GB) |
| Qwen 2.5 32B | Q4 | ~24 | ✅ (19GB) |
| Codestral 22B | Q4 | ~41 | ✅ (12GB) |
| Llama 3.1 70B | Q4_K_M | ~10-15* | ❌ (40GB → partial offload) |

*70B kræver offload til RAM = langsom. 32B er sweet spot for 24GB.

## ROCm vs Vulkan

| Backend | Prompt Processing | Token Generation | Status |
|---------|------------------|-------------------|--------|
| **ROCm** | ~2500 tok/s | ~85-95 tok/s | ✅ Stable, recommended |
| **Vulkan** | ~660 tok/s | ~65 tok/s | ⚠️ Experimental, slower |

**Konklusion:** ROCm er klart bedre. Vulkan er fallback for GPUs uden ROCm support — din 7900 XTX har fuld ROCm, så brug det.

## ⚠️ WSL2 Gotcha

**Kendt problem:** Ollama issue #9599 — Ollama i WSL2 kan IKKE detektere AMD GPU korrekt.
- WSL2 mangler `amdgpu` kernel driver (kun userland bits)
- Ollama's GPU detection fejler → falder tilbage til CPU
- ROCm i WSL2 med AMD er ikke trivielt

**Løsning:** Kør Ollama **direkte på Windows** (native installer), ikke i WSL2.
- Windows har fuld ROCm 6.1+ support for 7900 XTX
- Ollama Windows binary detekterer GPU korrekt

## Trading Team Use Case

### Hvad det løser:
- **Nova/Sentinel/Edge** kører pt på Sonnet (quota-begrænset, reset torsdag)
- Lokal 32B model (f.eks. Qwen 2.5 32B) = **uendelig quota, 0 kr/måned**
- ~24 tok/s er rigeligt til analyse-output (ikke latency-kritisk som live trading)

### Hvad det IKKE erstatter:
- **Opus for live trading decisions** — lokal LLM kan ikke matche Opus kvalitet for 72%+ confidence calls
- Men for daglig analyse, briefings, og Discord diskussioner? Mere end godt nok.

### Arkitektur-idé:
```
Trading Team Agents (Nova/Sentinel/Edge)
  → Ollama (Windows native, port 11434)
  → Qwen 2.5 32B eller Llama 3.1 8B
  → 0 API cost, uendelig usage

Live Trading Decisions
  → OpenClaw → Opus (som nu)
  → Kvalitet > hastighed for rigtige penge
```

## Modeller at teste (prioriteret)

1. **Qwen 2.5 32B Q4** — Bedste quality/speed ratio for 24GB (24 tok/s, stærk reasoning)
2. **Llama 3.1 8B Q8** — Hurtigst (67 tok/s), god til hurtig analyse
3. **DeepSeek R1 32B** — Stærk reasoning, god til strategi
4. **Mistral 7B FP16** — Hurtig (48 tok/s), god generalist

## Next Steps

1. **Installer Ollama på Windows** (native, IKKE WSL2)
   - Download: https://ollama.com/download/windows
   - Verificer GPU detection: `ollama run llama3.1:8b` → tjek at den bruger GPU
2. **Benchmark på din specifikke hardware** (varierer med driver version)
3. **Test Qwen 2.5 32B** som trading analyst model
4. **Evt. expose via API** til OpenClaw/NoFx adapter (port 11434)

## Estimeret tidsforbrug
- Installation + test: ~30 min
- Benchmark suite: ~1 time
- Integration med trading team: ~2-3 timer

---
*Sov godt Thomas. Research klar til morgenkaffen ☕*
