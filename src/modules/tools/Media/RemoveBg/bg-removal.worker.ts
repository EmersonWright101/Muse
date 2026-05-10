// src/workers/bg-removal.worker.ts
import { removeBackground, type Config } from '@imgly/background-removal';

// 定义传入 Worker 的数据类型
interface WorkerMessage {
  file: File;
  config: Config;
}

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const { file, config } = e.data;

  try {
    // 在 Worker 线程中执行繁重的计算
    const blob = await removeBackground(file, {
      ...config,
      // 在 Worker 中我们不需要 progress 回调去更新 UI，
      // 因为主线程已经不会被阻塞了，可以直接用时间动画
    });

    // 计算完成，将结果 Blob 发回主线程
    self.postMessage({ type: 'success', blob });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error in worker";
    self.postMessage({ type: 'error', error: msg });
  }
};