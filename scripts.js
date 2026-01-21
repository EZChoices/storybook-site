// scripts.js

document.addEventListener('DOMContentLoaded', function () {
    const photoBoxes = document.querySelectorAll('.photo-box');
    const uploadedPhotos = new Array(photoBoxes.length);
  
    photoBoxes.forEach((box, index) => {
      box.addEventListener('click', () => {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
  
        fileInput.onchange = () => {
          const file = fileInput.files[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = () => {
              box.style.backgroundImage = `url(${reader.result})`;
              box.style.backgroundSize = 'cover';
              box.textContent = '';
              uploadedPhotos[index] = file;
            };
            reader.readAsDataURL(file);
          }
        };
  
        fileInput.click();
      });
    });
  
    // Preview button functionality
    document.querySelector('.preview-button').addEventListener('click', () => {
      const childName = document.getElementById('childName').value.trim();
      const filledPhotos = Array.from(document.querySelectorAll('.photo-box')).filter(
        box => box.style.backgroundImage && box.style.backgroundImage !== 'none'
      );
  
      if (!childName) {
        alert("Please enter your child’s name.");
        return;
      }
  
      if (filledPhotos.length < 4) {
        alert("Please upload at least 4 photos.");
        return;
      }
  
      alert("Preview coming soon!\n\n(Everything looks good!)");
    });
  });
  