import "./style.css";
import OBR from "@owlbear-rodeo/sdk";

const status = document.querySelector("#launcher-status");
const button = document.querySelector("#open-board");
const MODAL_ID = "com.investigationboard.owlbear/modal";

OBR.onReady(() => {
  status.textContent = "Conectado à sala do Owlbear.";
  button.disabled = false;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await OBR.modal.open({
        id: MODAL_ID,
        url: new URL("./board.html", window.location.href).href,
        fullScreen: true
      });
    } catch (error) {
      console.error(error);
      status.textContent = "Não foi possível abrir o quadro. Confira se a extensão está instalada em uma sala.";
    } finally {
      button.disabled = false;
    }
  });
});
