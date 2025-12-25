<script setup lang="ts">
import { ref, onUnmounted, Ref, computed, watch, onBeforeMount } from "vue";
import type { PDFDocumentProxy } from "./index";

let GlobalWorkerOptions: any, getDocument: any;
const dpr = ref(1);
defineOptions({
  name: "pdf-ysk-vue3",
});
const props = withDefaults(
  defineProps<{
    /**
     * pdf url | Uint8Array | BASE64
     */
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
    // --custom--
    adInterval?: number;
    adContent?: string;
    showProgress?: boolean;
    progressColor?: string;
    showPageTooltip?: boolean;
    showBackToTopBtn?: boolean;
    scrollThreshold?: number;
    pdfWidth?: string;
    rowGap?: number;
    page?: number;
    cMapUrl?: string;
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
    adInterval: 10,
    adContent: "",
    showProgress: true,
    progressColor: "#87ceeb",
    showPageTooltip: true,
    showBackToTopBtn: true,
    scrollThreshold: 300,
    pdfWidth: "100%",
    rowGap: 8,
    page: 1,
    cMapUrl: "https://unpkg.com/pdfjs-dist@3.7.107/cmaps/",
  }
);

const rowGap = computed(() => parseInt(String(props.rowGap)));

const emit = defineEmits<{
  (e: "onProgress", loadRatio: number): void;
  (e: "onComplete"): void;
  (e: "onScroll", scrollOffset: number): void;
  (e: "onPageChange", page: number): void;
  /**
   * https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFDocumentProxy.html
   */
  (e: "onPdfInit", pdf: PDFDocumentProxy): void;
}>();

const slots = defineSlots<{
  progress?: (props: { loadRatio: number }) => any;
  pageTooltip?: (props: { currentPage: number; totalPages: number }) => any;
  backToTopBtn?: (props: { scrollOffset: number }) => any;
}>();

const canvasRefs = ref<Array<Ref<Array<HTMLCanvasElement>>>>([]);

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

const loadRatio = ref(0);
const loadingTask = ref<any>(null);
const getDoc = () => {
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
  loadRatio.value = 0;
  loadingTask.value = getDocument(option);
  loadingTask.value.onProgress = (progressData: any) => {
    const ratio = (progressData.loaded / progressData.total) * 100;
    loadRatio.value = ratio >= 100 ? 100 : ratio;
    emit("onProgress", loadRatio.value);
  };
  loadingTask.value.promise.then(() => {
    emit("onComplete");
  });
};

const totalPages = ref(0);
const currentPage = ref(1);
const scrollOffset = ref(0);
const itemHeightList = ref<Array<number>>([]);
const renderedCanvasCount = ref(10); // Start with 10 canvases

const scroller = ref<HTMLDivElement>() as Ref<HTMLDivElement>;
const container = ref<HTMLDivElement>() as Ref<HTMLDivElement>;

const renderedPages = ref(new Set<number>());
let observer: IntersectionObserver;
let pdf: PDFDocumentProxy;
const cancelRendering = ref(false);
const renderComplete = ref(false);

const renderPage = async (pageNumber: number) => {
  if (renderedPages.value.has(pageNumber)) return;
  
  try {
    const page = await pdf.getPage(pageNumber);
    const canvas = canvasRefs.value[pageNumber - 1].value[0];
    const context = canvas.getContext("2d");
    
    // We already set the dimensions in the layout phase, but we need the viewport for rendering
    // Re-calculate viewport to ensure correctness or store it? 
    // Storing might consume memory, re-calculating is cheap.
    // We need the scale again.
    const viewport = page.getViewport({ scale: 1 });
    const scale = ((canvas.parentNode as HTMLDivElement).clientWidth - 4) / viewport.width;
    const scaledViewport = page.getViewport({ scale: scale * dpr.value });

    await page.render({
      canvasContext: context as CanvasRenderingContext2D,
      viewport: scaledViewport,
    }).promise;

    renderedPages.value.add(pageNumber);

    // Ad insertion logic - moved here to ensure it happens after render or we can do it in layout?
    // If we do it in layout, the ad might load before the page is visible? 
    // Better to keep it here or check if it needs to be visible.
    // The original code inserted it after render. Let's keep it here.
    if (pageNumber % props.adInterval === 0 && props.adContent) {
        // Check if ad already exists to avoid duplicates if re-rendered (though we check renderedPages)
        // logic from original code
        const adWrapper = document.createElement("ins");
        adWrapper.className = "adsbygoogle";
        adWrapper.style.cssText = `
  display: block;
  text-align: center;
  margin: 20px auto;
  padding: 10px 0;
  width: 90%;
`;
        adWrapper.setAttribute("data-ad-client", "ca-pub-4915623133359828");
        adWrapper.setAttribute("data-ad-slot", "5506775687");
        adWrapper.setAttribute("data-ad-format", "auto");
        adWrapper.setAttribute("data-full-width-responsive", "true");

        // Insert the <ins> AFTER the canvas
        // Fix: Insert after the canvas itself, not the parent container
        if (canvas.nextElementSibling?.className !== 'adsbygoogle') {
             canvas.insertAdjacentElement("afterend", adWrapper);

            // Create <script> for AdSense refresh
            const script = document.createElement("script");
            script.textContent =
            "(adsbygoogle = window.adsbygoogle || []).push({});";

            // Insert script after <ins>
            adWrapper.insertAdjacentElement("afterend", script);
        }
    }

  } catch (error) {
    console.error(`Error rendering page ${pageNumber}:`, error);
  }
};

const renderPDF = async () => {
  renderComplete.value = false;
  renderedPages.value.clear();
  
  // Disconnect previous observer if exists
  if (observer) {
    observer.disconnect();
  }

  try {
    if (!pdf) {
      pdf = await loadingTask.value.promise;
      const refs = [];
      for (let i = 0; i < pdf.numPages; i++) {
        refs.push(ref() as Ref<Array<HTMLCanvasElement>>);
      }
      canvasRefs.value = refs;
      totalPages.value = pdf.numPages;
      emit("onPdfInit", pdf);
    }
  } catch (error) {
    console.error("Error loadingTask PDF:", error);
    return;
  }

  // Initialize IntersectionObserver
  observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const pageIndex = Number((entry.target as HTMLElement).dataset.pageIndex);
        renderPage(pageIndex + 1);
        observer.unobserve(entry.target);
      }
    });
  }, {
    root: scroller.value,
    rootMargin: "0px", // Render only when page enters viewport
    threshold: 0.01 // Trigger as soon as 1% is visible
  });

  let calcH = 0;
  
  // Optimization: Fetch pages in batches to speed up layout without blocking too much
  const BATCH_SIZE = 10;
  for (let i = 0; i < totalPages.value; i += BATCH_SIZE) {
    if (cancelRendering.value) {
        cancelRendering.value = false;
        renderPDF();
        break;
    }

    const batchPromises = [];
    const end = Math.min(i + BATCH_SIZE, totalPages.value);
    
    for (let j = i; j < end; j++) {
        batchPromises.push(pdf.getPage(j + 1));
    }

    try {
        const pages = await Promise.all(batchPromises);
        
        for (let k = 0; k < pages.length; k++) {
            const page = pages[k];
            const pageIndex = i + k;
            const canvas = canvasRefs.value[pageIndex].value[0];
            
            // Layout phase: Set dimensions
            var viewport = page.getViewport({ scale: 1 });
            var scale =
                ((canvas.parentNode as HTMLDivElement).clientWidth - 4) /
                viewport.width;
            
            const scaledViewport = page.getViewport({ scale: scale * dpr.value });
            canvas.width = scaledViewport.width;
            canvas.height = scaledViewport.height;
            
            // Draw Loading text
            const context = canvas.getContext("2d");
            if (context) {
                context.font = "20px Arial";
                context.fillStyle = "#999";
                context.textAlign = "center";
                context.fillText("Loading...", canvas.width / 2, canvas.height / 2);
            }

            // Store height for scrolling logic
            itemHeightList.value[pageIndex] = calcH +=
                scaledViewport.height / dpr.value + rowGap.value;

            // Set data attribute for observer
            canvas.dataset.pageIndex = String(pageIndex);
            
            // Start observing
            observer.observe(canvas);
            
            if (pageIndex === totalPages.value - 1) {
                renderComplete.value = true;
            }
        }
        
        // Update scroll position if needed (only once per batch or per page? Per batch is fine)
        // We need to check if we are at the target page
        if (props.page) {
             const targetIndex = props.page - 1;
             if (targetIndex >= i && targetIndex < end) {
                 scroller.value.scrollTo(0, (itemHeightList.value[targetIndex - 1] ?? 0) + 2);
             }
        }

    } catch (error) {
        console.error("Error laying out PDF pages batch:", error);
    }
  }
};

const viewportHeight = ref(0);
const isScrolling = ref(false);

let scrollTimer: number;
const handleScroll = (event: any) => {
  isScrolling.value = true;
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    isScrolling.value = false;
  }, 1000);
  scrollOffset.value = event.target.scrollTop;
  emit("onScroll", event.target.scrollTop);
  
  // Virtual scrolling: Add more canvases as user scrolls down
  if (renderedCanvasCount.value < totalPages.value) {
    const scrollPercentage = (scroller.value.scrollTop + scroller.value.offsetHeight) / scroller.value.scrollHeight;
    if (scrollPercentage > 0.7) { // When 70% scrolled, add more canvases
      renderedCanvasCount.value = Math.min(renderedCanvasCount.value + 10, totalPages.value);
    }
  }
  
  if (
    scroller.value.scrollTop + scroller.value.offsetHeight >=
    scroller.value.scrollHeight - 10
  ) {
    currentPage.value = itemHeightList.value.length;
    return;
  }

  for (let i = 0; i < itemHeightList.value.length; i++) {
    const height = itemHeightList.value[i];
    if (height > event.target.scrollTop) {
      currentPage.value = i + 1;
      break;
    }
  }
};

let timer: number;
const renderPDFWithDebounce = () => {
  viewportHeight.value = window.innerHeight;
  if (
    Math.abs(innerWidth.value - window.innerWidth) > 1 &&
    Math.abs(containerWidth.value - container.value.offsetWidth) > 1
  ) {
    setWidth();
  } else {
    setWidth();
    return;
  }
  cancelRendering.value = true;
  clearTimeout(timer);
  timer = setTimeout(() => {
    renderComplete.value && renderPDF();
  }, 500);
};

const innerWidth = ref<number>(0);
const containerWidth = ref<number>(0);
const setWidth = () => {
  innerWidth.value = window.innerWidth;
  containerWidth.value = container.value.offsetWidth;
};
const isAddEvent = ref(false);
onBeforeMount(async () => {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.min.js")).default;
  GlobalWorkerOptions = pdfjs.GlobalWorkerOptions;
  getDocument = pdfjs.getDocument;
  const workerSrc = new URL(
    "../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.js",
    import.meta.url
  ).href;
  GlobalWorkerOptions.workerSrc = workerSrc;
  dpr.value = window.devicePixelRatio || 1;
  viewportHeight.value = window.innerHeight;
  setWidth();
  if (
    (typeof props.src === "string" && props.src.length > 0) ||
    props.src instanceof Uint8Array
  ) {
    getDoc();
    renderPDF();
    window.addEventListener("resize", renderPDFWithDebounce);
    isAddEvent.value = true;
  }
  watch(
    () => props.src,
    (src: string | Uint8Array) => {
      if (
        (typeof src === "string" && src.length > 0) ||
        src instanceof Uint8Array
      ) {
        getDoc();
        renderPDF();
        if (!isAddEvent.value) {
          window.addEventListener("resize", renderPDFWithDebounce);
          isAddEvent.value = true;
        }
      }
    }
  );
});

defineExpose({
  //user set pdfWidth but pdf is blurred
  //when container resize and widnow not resize, you can call reload
  reload: () => {
    innerWidth.value = window.innerWidth - 2;
    renderPDFWithDebounce();
    setWidth();
  },
});

onUnmounted(() => {
  clearTimeout(timer);
  clearTimeout(scrollTimer);
  cancelAnimationFrame(animFrameId);
  isAddEvent.value &&
    window.removeEventListener("resize", renderPDFWithDebounce);
});
// --- back to top ---
let animFrameId: number;
const easeOutCubic = (progress: number) => {
  return 1 - Math.pow(1 - progress, 3);
};
const backToTop = () => {
  const duration = 500;
  const startPos = scroller.value.scrollTop;
  const startTime = performance.now();

  const animateScroll = (timestamp: number) => {
    const elapsed = timestamp - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easeProgress = easeOutCubic(progress);
    const distance = startPos * (1 - easeProgress);

    scroller.value.scrollTo(0, distance);

    if (progress < 1) {
      animFrameId = requestAnimationFrame(animateScroll);
    }
  };
  cancelAnimationFrame(animFrameId);
  requestAnimationFrame(animateScroll);
};
let waitToPageFun: Function | null = null;
watch(
  () => props.page,
  (page: number) => {
    if (props.page === currentPage.value) {
      return;
    }
    if (page > itemHeightList.value.length) {
      page = itemHeightList.value.length;
    }
    if (renderComplete.value) {
      scroller.value.scrollTo(0, (itemHeightList.value[page - 2] ?? 0) + 2);
    } else {
      waitToPageFun = () => {
        scroller.value.scrollTo(0, (itemHeightList.value[page - 2] ?? 0) + 2);
      };
    }
  }
);
watch(
  () => renderComplete.value,
  (complete: boolean) => {
    complete && waitToPageFun?.();
    waitToPageFun = null;
  }
);
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
    <div class="pdf-vue3-container" style="height: 100%">
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
          <canvas
            style="
              display: block;
              box-shadow: #a9a9a9 0px 1px 3px 0px;
              margin-left: auto;
              margin-right: auto;
              width: calc(100% - 4px);
            "
            :style="{
              marginBottom: `${rowGap}px`,
            }"
            v-for="item in renderedCanvasCount"
            :key="item"
            :ref="canvasRefs[item - 1]"
          ></canvas>
        </div>
      </div>
    </div>
    <div
      class="pdf-vue3-progress"
      v-if="props.showProgress"
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
    <div
      class="pdf-vue3-pageTooltip"
      v-if="props.showPageTooltip"
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
    <div
      class="pdf-vue3-backToTopBtn"
      v-if="props.showBackToTopBtn"
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

<style></style>
