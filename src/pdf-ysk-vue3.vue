<script setup lang="ts">
import {
  ref,
  onUnmounted,
  computed,
  watch,
  onBeforeMount,
  onMounted,
  nextTick,
} from "vue";
import type { PDFDocumentProxy } from "./index";

// 声明全局变量
let GlobalWorkerOptions: any = null;
let getDocument: any = null;
const dpr = ref(1);

defineOptions({
  name: "pdf-ysk-vue3",
});

const props = withDefaults(
  defineProps<{
    src: string | Uint8Array;
    httpHeaders?: Record<string, any>;
    withCredentials?: boolean;
    password?: string;
    useSystemFonts?: boolean;
    stopAtErrors?: boolean;
    disableFontFace?: boolean;
    disableRange?: boolean;
    disableStream?: boolean;
    disableAutoFetch?: boolean;
    showProgress?: boolean;
    progressColor?: string;
    showPageTooltip?: boolean;
    showBackToTopBtn?: boolean;
    scrollThreshold?: number;
    pdfWidth?: string;
    rowGap?: number;
    page?: number;
    cMapUrl?: string;
    batchSize?: number; // Number of pages to render in each batch
  }>(),
  {
    src: undefined,
    httpHeaders: undefined,
    withCredentials: undefined,
    password: undefined,
    useSystemFonts: undefined,
    stopAtErrors: undefined,
    disableFontFace: undefined,
    disableRange: undefined,
    disableStream: undefined,
    disableAutoFetch: undefined,
    showProgress: true,
    progressColor: "#87ceeb",
    showPageTooltip: true,
    showBackToTopBtn: true,
    scrollThreshold: 300,
    pdfWidth: "100%",
    rowGap: 8,
    page: 1,
    cMapUrl: "https://unpkg.com/pdfjs-dist@3.7.107/cmaps/",
    batchSize: 10, // Default: render 10 pages at a time
  }
);

const rowGap = computed(() => parseInt(String(props.rowGap)));

const emit = defineEmits<{
  (e: "onProgress", loadRatio: number): void;
  (e: "onComplete"): void;
  (e: "onScroll", scrollOffset: number): void;
  (e: "onPageChange", page: number): void;
  (e: "onPdfInit", pdf: PDFDocumentProxy): void;
}>();

const slots = defineSlots<{
  progress?: (props: { loadRatio: number }) => any;
  pageTooltip?: (props: { currentPage: number; totalPages: number }) => any;
  backToTopBtn?: (props: { scrollOffset: number }) => any;
}>();

// Store canvas elements
const canvasElements = ref<HTMLCanvasElement[]>([]);

interface Option extends Record<string, any> {
  url?: string;
  data?: Uint8Array;
  httpHeaders?: Record<string, any>;
  withCredentials?: boolean;
  password?: string;
  useSystemFonts?: boolean;
  stopAtErrors?: boolean;
  disableFontFace?: boolean;
  disableRange?: boolean;
  disableStream?: boolean;
  disableAutoFetch?: boolean;
}

const downloadRatio = ref(0);
const renderRatio = ref(0);
const loadRatio = computed(() => {
  // Keep bar moving smoothly across both phases: download (0-50) + render (50-100).
  return Math.min(100, downloadRatio.value * 0.5 + renderRatio.value * 0.5);
});
const loadingTask = ref<any>(null);
const getDoc = () => {
  if (!getDocument) {
    console.error("PDF.js is not loaded yet");
    throw new Error("PDF.js is not loaded yet");
  }

  const option: Option = {
    httpHeaders: props.httpHeaders,
    withCredentials: props.withCredentials,
    password: props.password,
    useSystemFonts: props.useSystemFonts,
    stopAtErrors: props.stopAtErrors,
    disableFontFace: props.disableFontFace,
    disableRange: props.disableRange,
    disableStream: props.disableStream,
    disableAutoFetch: props.disableAutoFetch,
    cMapUrl: props.cMapUrl,
  };

  if (props.src instanceof Uint8Array) {
    option.data = props.src;
  } else if (props.src.endsWith(".pdf")) {
    option.url = props.src;
  } else {
    const binaryData = atob(
      props.src.includes(",") ? props.src.split(",")[1] : props.src
    );
    const byteArray = new Uint8Array(binaryData.length);
    for (let i = 0; i < binaryData.length; i++) {
      byteArray[i] = binaryData.charCodeAt(i);
    }
    option.data = byteArray;
  }

  for (const key in option) {
    if (option[key] === undefined) {
      delete option[key];
    }
  }

  downloadRatio.value = 0;
  renderRatio.value = 0;
  emit("onProgress", loadRatio.value);
  loadingTask.value = getDocument(option);
  loadingTask.value.onProgress = (progressData: any) => {
    const total = Number(progressData?.total || 0);
    const loaded = Number(progressData?.loaded || 0);
    // Some servers do not provide total bytes; keep ratio at 0 until we can measure.
    if (total > 0) {
      const ratio = (loaded / total) * 100;
      downloadRatio.value = ratio >= 100 ? 100 : ratio;
      emit("onProgress", loadRatio.value);
    }
  };
  loadingTask.value.promise.then(() => {
    downloadRatio.value = 100;
    emit("onProgress", loadRatio.value);
    emit("onComplete");
  });
};

const totalPages = ref(0);
const currentPage = ref(1);
const scrollOffset = ref(0);
const itemHeightList = ref<number[]>([]);

const scroller = ref<HTMLDivElement>();
const container = ref<HTMLDivElement>();

let pdf: PDFDocumentProxy | null = null;
const cancelRendering = ref(false);
const renderComplete = ref(false);
const isRendering = ref(false);
const renderedPages = ref(0); // Track how many pages have been rendered

// Cleanup all canvas elements
const cleanupCanvases = () => {
  canvasElements.value.forEach((canvas) => {
    if (canvas && canvas.parentNode) {
      canvas.parentNode.removeChild(canvas);
    }
  });
  canvasElements.value = [];
  itemHeightList.value = [];
  renderedPages.value = 0;
};

// Render a batch of pages
const renderBatch = async (startPage: number, endPage: number) => {
  if (!pdf || cancelRendering.value) return;

  const containerWidth = container.value?.clientWidth || 0;
  if (containerWidth <= 0) return;

  for (let i = startPage; i <= endPage && i < totalPages.value; i++) {
    if (cancelRendering.value) break;

    const pageNum = i;

    try {
      // Get page
      const page = await pdf.getPage(pageNum + 1);

      // Calculate scaling
      const viewport = page.getViewport({ scale: 1 });
      const scale = (containerWidth - 4) / viewport.width;
      const scaledViewport = page.getViewport({ scale: scale * dpr.value });
      const pageHeight = scaledViewport.height / dpr.value;

      // Create canvas
      const canvas = document.createElement("canvas");
      const canvasId = `pdf-canvas-b${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}-${pageNum}`;
      canvas.id = canvasId;
      canvas.style.cssText = `
        display: block;
        box-shadow: #a9a9a9 0px 1px 3px 0px;
        margin-left: auto;
        margin-right: auto;
        width: calc(100% - 4px);
        margin-bottom: ${rowGap.value}px;
        height: ${pageHeight}px;
      `;

      canvas.width = scaledViewport.width;
      canvas.height = scaledViewport.height;

      // Add to DOM
      if (container.value) {
        container.value.appendChild(canvas);
      }
      canvasElements.value[pageNum] = canvas;

      // Get context and render
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Failed to get canvas context");
      }

      context.clearRect(0, 0, canvas.width, canvas.height);

      const renderTask = page.render({
        canvasContext: context,
        viewport: scaledViewport,
      });

      await renderTask.promise;

      // Calculate and store height
      let cumulativeHeight = 0;
      for (let j = 0; j <= pageNum; j++) {
        // Get height of previous page or use 0
        const prevCanvas = canvasElements.value[j];
        if (prevCanvas) {
          cumulativeHeight +=
            prevCanvas.height / dpr.value + (j < pageNum ? rowGap.value : 0);
        }
      }
      itemHeightList.value[pageNum] = cumulativeHeight;

      // Update rendered pages count
      renderedPages.value++;

      // Update render progress (second half of progress bar).
      if (totalPages.value > 0) {
        renderRatio.value = Math.min(
          100,
          (renderedPages.value / totalPages.value) * 100
        );
        emit("onProgress", loadRatio.value);
      }

      // If this is the target page, scroll to it
      if (
        props.page &&
        pageNum + 1 === Math.min(props.page, totalPages.value)
      ) {
        const scrollToHeight =
          pageNum > 0 ? itemHeightList.value[pageNum - 1] + 2 : 0;
        if (scroller.value) {
          scroller.value.scrollTo(0, scrollToHeight);
        }
      }
    } catch (error: any) {
      if (error && error.name === "RenderingCancelledException") {
        console.log(`Rendering cancelled for page ${pageNum + 1}`);
        break;
      } else {
        console.error(`Error rendering PDF page ${pageNum + 1}:`, error);
      }
    }
  }
};

// Main render function - renders in batches
const renderPDF = async () => {
  // If already rendering, cancel and restart
  if (isRendering.value) {
    cancelRendering.value = true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (!loadingTask.value || !loadingTask.value.promise) {
    console.error("Loading task is not initialized");
    return;
  }

  // Reset
  cleanupCanvases();
  renderRatio.value = 0;
  emit("onProgress", loadRatio.value);
  renderComplete.value = false;
  isRendering.value = true;
  cancelRendering.value = false;

  try {
    if (!pdf) {
      const loadedPdf = await loadingTask.value.promise;
      pdf = loadedPdf;
      totalPages.value = loadedPdf.numPages;
      emit("onPdfInit", loadedPdf);
    }
  } catch (error) {
    console.error("Error loading PDF:", error);
    isRendering.value = false;
    return;
  }

  if (!container.value) {
    console.error("Container not found");
    isRendering.value = false;
    return;
  }

  const containerWidth = container.value.clientWidth;
  if (containerWidth <= 0) {
    console.error("Container width is 0");
    isRendering.value = false;
    return;
  }

  const batchSize = props.batchSize || 10;

  // Render first batch immediately
  const firstBatchEnd = Math.min(batchSize, totalPages.value) - 1;
  await renderBatch(0, firstBatchEnd);

  // Set up intersection observer for lazy loading
  setupIntersectionObserver();

  // Mark as partially complete (first batch done)
  renderComplete.value = true;
  isRendering.value = false;

  if (renderedPages.value >= totalPages.value && totalPages.value > 0) {
    renderRatio.value = 100;
    emit("onProgress", loadRatio.value);
  }
};

// Intersection observer for lazy loading
let observer: IntersectionObserver | null = null;
const setupIntersectionObserver = () => {
  if (!container.value || observer) return;

  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && !isRendering.value) {
          const canvas = entry.target as HTMLCanvasElement;
          const canvasId = canvas.id;
          const match = canvasId.match(/pdf-canvas-b\d+-[^-]+-(\d+)/);

          if (match) {
            const pageNum = parseInt(match[1]);
            // If we're near the end, render more pages
            if (pageNum >= renderedPages.value - 5) {
              loadMorePages();
            }
          }
        }
      });
    },
    {
      root: scroller.value,
      rootMargin: "200px 0px", // Load 200px before entering viewport
      threshold: 0.1,
    }
  );

  // Observe existing canvases
  canvasElements.value.forEach((canvas) => {
    if (canvas) observer?.observe(canvas);
  });
};

// Load more pages when scrolling near the bottom
const loadMorePages = async () => {
  if (
    isRendering.value ||
    cancelRendering.value ||
    renderedPages.value >= totalPages.value
  ) {
    return;
  }

  isRendering.value = true;

  const batchSize = props.batchSize || 10;
  const startPage = renderedPages.value;
  const endPage = Math.min(startPage + batchSize - 1, totalPages.value - 1);

  await renderBatch(startPage, endPage);

  // Observe new canvases
  if (observer) {
    for (
      let i = startPage;
      i <= endPage && i < canvasElements.value.length;
      i++
    ) {
      const canvas = canvasElements.value[i];
      if (canvas) observer.observe(canvas);
    }
  }

  isRendering.value = false;

  // If all pages rendered, disconnect observer
  if (renderedPages.value >= totalPages.value) {
    observer?.disconnect();
    observer = null;
  }
};

// Handle scroll
let scrollTimer: number;
const handleScroll = (event: any) => {
  isScrolling.value = true;
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    isScrolling.value = false;
  }, 1000);

  const scrollTop = event.target.scrollTop;
  scrollOffset.value = scrollTop;
  emit("onScroll", scrollTop);

  // Find current page
  if (itemHeightList.value.length > 0) {
    for (let i = 0; i < itemHeightList.value.length; i++) {
      const height = itemHeightList.value[i];
      if (height > scrollTop) {
        if (currentPage.value !== i + 1) {
          currentPage.value = i + 1;
          emit("onPageChange", i + 1);
        }
        break;
      }
    }
  }

  // Check if we need to load more pages (near bottom)
  const scrollElement = event.target;
  const nearBottom =
    scrollElement.scrollTop + scrollElement.clientHeight >=
    scrollElement.scrollHeight - 500;

  if (
    nearBottom &&
    !isRendering.value &&
    renderedPages.value < totalPages.value
  ) {
    loadMorePages();
  }
};

const viewportHeight = ref(0);
const isScrolling = ref(false);

let resizeTimer: number;
const handleResize = () => {
  viewportHeight.value = window.innerHeight;

  clearTimeout(resizeTimer);

  resizeTimer = setTimeout(async () => {
    if (pdf && !isRendering.value) {
      // Re-render all pages with new size
      cancelRendering.value = true;
      setTimeout(() => {
        renderPDF();
      }, 300);
    }
  }, 500);
};

const innerWidth = ref<number>(0);
const containerWidth = ref<number>(0);
const setWidth = () => {
  innerWidth.value = window.innerWidth;
  containerWidth.value = container.value?.offsetWidth || 0;
};

const isAddEvent = ref(false);
const isPdfJsLoaded = ref(false);
const isInitialized = ref(false);

// Load PDF.js
const loadPdfJs = async () => {
  try {
    console.log("Loading PDF.js...");

    let pdfjs;
    try {
      const pdfjsModule = await import("pdfjs-dist");
      pdfjs = pdfjsModule.default || pdfjsModule;
    } catch (error1) {
      console.log("Direct import failed, trying legacy build...");
      const pdfjsModule = await import("pdfjs-dist/legacy/build/pdf");
      pdfjs = pdfjsModule.default || pdfjsModule;
    }

    if (!pdfjs) {
      throw new Error("Failed to import PDF.js");
    }

    GlobalWorkerOptions = pdfjs.GlobalWorkerOptions;
    getDocument = pdfjs.getDocument;

    // Set worker source
    try {
      const workerUrl = new URL(
        "pdfjs-dist/build/pdf.worker.min.js",
        import.meta.url
      );
      GlobalWorkerOptions.workerSrc = workerUrl.href;
    } catch (workerError) {
      GlobalWorkerOptions.workerSrc =
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.7.107/build/pdf.worker.min.js";
    }

    isPdfJsLoaded.value = true;
    console.log("PDF.js loaded successfully");

    initializeComponent();
  } catch (error) {
    console.error("Failed to load PDF.js:", error);
  }
};

// Initialize component
const initializeComponent = () => {
  if (isInitialized.value) return;

  dpr.value = window.devicePixelRatio || 1;
  viewportHeight.value = window.innerHeight;

  nextTick(() => {
    if (container.value) {
      setWidth();
    }

    if (
      (typeof props.src === "string" && props.src.length > 0) ||
      props.src instanceof Uint8Array
    ) {
      try {
        getDoc();
        setTimeout(() => {
          renderPDF();
        }, 200);

        window.addEventListener("resize", handleResize);
        isAddEvent.value = true;
      } catch (error) {
        console.error("Failed to load PDF document:", error);
      }
    }

    isInitialized.value = true;
  });
};

onBeforeMount(async () => {
  loadPdfJs();
});

onMounted(() => {
  if (isPdfJsLoaded.value) {
    initializeComponent();
  }
});

// Watch src changes
watch(
  () => props.src,
  (src: string | Uint8Array) => {
    if (!isPdfJsLoaded.value) {
      console.log("PDF.js not loaded yet, delaying PDF load...");
      return;
    }

    if (
      (typeof src === "string" && src.length > 0) ||
      src instanceof Uint8Array
    ) {
      try {
        cancelRendering.value = true;

        // Clean observer
        if (observer) {
          observer.disconnect();
          observer = null;
        }

        // Clean and reload
        setTimeout(() => {
          pdf = null;
          cleanupCanvases();
          getDoc();

          loadingTask.value.promise.then(() => {
            renderPDF();
          });

          if (!isAddEvent.value) {
            window.addEventListener("resize", handleResize);
            isAddEvent.value = true;
          }
        }, 200);
      } catch (error) {
        console.error("Failed to load PDF document:", error);
      }
    }
  }
);

// Watch PDF.js load status
watch(
  () => isPdfJsLoaded.value,
  (loaded: boolean) => {
    if (loaded && !isInitialized.value) {
      initializeComponent();
    }
  }
);

// Expose methods
defineExpose({
  reload: () => {
    cancelRendering.value = true;
    setTimeout(() => {
      renderPDF();
    }, 200);
  },
  loadMorePages: () => {
    loadMorePages();
  },
});

onUnmounted(() => {
  clearTimeout(resizeTimer);
  clearTimeout(scrollTimer);
  cancelAnimationFrame(animFrameId);

  if (observer) {
    observer.disconnect();
    observer = null;
  }

  cleanupCanvases();

  if (isAddEvent.value) {
    window.removeEventListener("resize", handleResize);
  }
});

// --- back to top ---
let animFrameId: number;
const easeOutCubic = (progress: number) => {
  return 1 - Math.pow(1 - progress, 3);
};
const backToTop = () => {
  const el = scroller.value;
  if (!el) return;

  const duration = 500;
  const startPos = el.scrollTop;
  const startTime = performance.now();

  const animateScroll = (timestamp: number) => {
    const elapsed = timestamp - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easeProgress = easeOutCubic(progress);
    const distance = startPos * (1 - easeProgress);

    el.scrollTo(0, distance);

    if (progress < 1) {
      animFrameId = requestAnimationFrame(animateScroll);
    }
  };

  cancelAnimationFrame(animFrameId);
  requestAnimationFrame(animateScroll);
};


// Watch page prop
watch(
  () => props.page,
  (page: number) => {
    if (page < 1 || page > totalPages.value || !scroller.value) {
      return;
    }

    // Calculate scroll position
    let scrollPosition = 0;
    for (let i = 0; i < page - 1 && i < itemHeightList.value.length; i++) {
      scrollPosition +=
        itemHeightList.value[i + 1] - itemHeightList.value[i] || 0;
    }

    scroller.value.scrollTo(0, scrollPosition);
  }
);

// Watch current page
watch(
  () => currentPage.value,
  (page: number) => {
    emit("onPageChange", page);
  }
);
</script>

<template>
  <div
    class="pdf-vue3-main"
    style="height: 100%; position: relative; min-height: 10px"
  >
    <!-- Loading state -->
    <div
      v-if="!isPdfJsLoaded"
      style="
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100%;
        color: #666;
      "
    >
      Loading PDF library...
    </div>

    <!-- PDF container -->
    <div v-else class="pdf-vue3-container" style="height: 100%">
      <div
        ref="scroller"
        class="pdf-vue3-scroller"
        style="height: 100%; overflow-y: auto"
        :style="{ maxHeight: `${viewportHeight}px` }"
        @scroll="handleScroll"
      >
        <div
          class="pdf-vue3-canvas-container"
          ref="container"
          style="margin: 0 auto"
          :style="{
            width: isNaN(Number(props.pdfWidth))
              ? props.pdfWidth
              : `${props.pdfWidth}px`,
          }"
        >
          <!-- Canvas elements are dynamically created here -->
        </div>

        <!-- Loading more indicator -->
        <div
          v-if="renderedPages < totalPages && totalPages > 0"
          style="
            text-align: center;
            padding: 20px;
            color: #666;
            font-size: 14px;
          "
        >
          Loading more pages... ({{ renderedPages }}/{{ totalPages }})
        </div>
      </div>
    </div>

    <!-- Progress bar -->
    <div
      class="pdf-vue3-progress"
      v-if="props.showProgress && isPdfJsLoaded"
      style="
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        user-select: none;
        pointer-events: none;
      "
    >
      <slot v-if="slots.progress" name="progress" :loadRatio="loadRatio"></slot>
      <div
        v-else
        style="width: 0%; height: 4px; transition: all 0.2s"
        :style="{
          width: `${loadRatio}%`,
          opacity: loadRatio < 100 ? '1' : '0',
          backgroundColor: props.progressColor,
        }"
      ></div>
    </div>

    <!-- Page tooltip -->
    <div
      class="pdf-vue3-pageTooltip"
      v-if="props.showPageTooltip && isPdfJsLoaded"
      style="
        position: absolute;
        left: 12px;
        top: 12px;
        width: calc(100% - 12px);
        user-select: none;
        pointer-events: none;
      "
    >
      <slot
        v-if="slots.pageTooltip"
        name="pageTooltip"
        :currentPage="currentPage"
        :totalPages="totalPages"
      ></slot>
      <div
        v-else
        style="
          padding: 4px 8px;
          background: rgba(0, 0, 0, 0.5);
          color: #ffffff;
          font-size: 16px;
          border-radius: 6px;
          display: inline-block;
          transition: opacity 0.3s;
        "
        :style="{ opacity: isScrolling && totalPages > 0 ? '1' : '0' }"
      >
        {{ currentPage }}/{{ totalPages }}
      </div>
    </div>

    <!-- Back to top button -->
    <div
      class="pdf-vue3-backToTopBtn"
      v-if="props.showBackToTopBtn && isPdfJsLoaded"
      @click="backToTop"
      style="
        position: absolute;
        right: 16px;
        bottom: 16px;
        display: inline-block;
        user-select: none;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.3s;
      "
      :style="
        scrollOffset > props.scrollThreshold
          ? { opacity: '1', pointerEvents: 'initial' }
          : undefined
      "
    >
      <slot
        v-if="slots.backToTopBtn"
        name="backToTopBtn"
        :scrollOffset="scrollOffset"
      ></slot>
      <div
        v-else
        style="
          width: 50px;
          height: 50px;
          background: rgba(0, 0, 0, 0.4);
          color: #ffffff;
          font-size: 16px;
          border-radius: 50%;
          display: flex;
          justify-content: center;
          align-items: center;
        "
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fill-rule="evenodd"
            clip-rule="evenodd"
            d="M11.0001 22.2877H13.0001V7.80237L16.2428 11.045L17.657 9.63079L12.0001 3.97394L6.34326 9.63079L7.75748 11.045L11.0001 7.80236V22.2877ZM18 3H6V1H18V3Z"
            fill="currentColor"
          />
        </svg>
      </div>
    </div>
  </div>
</template>
