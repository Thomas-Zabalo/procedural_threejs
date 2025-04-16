import {
    WebGLRenderer, ACESFilmicToneMapping, sRGBEncoding,
    Color, CylinderGeometry, FloatType,
    RepeatWrapping, DoubleSide, BoxGeometry, Mesh, PointLight, MeshPhysicalMaterial, PerspectiveCamera,
    Scene, PMREMGenerator, PCFSoftShadowMap,
    Vector2, TextureLoader, SphereGeometry, MeshStandardMaterial, DirectionalLightHelper, PointLightHelper
} from 'https://cdn.skypack.dev/three@0.137';
import { OrbitControls } from 'https://cdn.skypack.dev/three-stdlib@2.8.5/controls/OrbitControls';
import { RGBELoader } from 'https://cdn.skypack.dev/three-stdlib@2.8.5/loaders/RGBELoader';
import { mergeBufferGeometries } from 'https://cdn.skypack.dev/three-stdlib@2.8.5/utils/BufferGeometryUtils';
import SimplexNoise from 'https://cdn.skypack.dev/simplex-noise@3.0.0';

// Resource tracking system
const resources = {
    meshes: [],
    geometries: [],
    materials: [],
    textures: [],
    envmaps: []
};

// DOM Elements
const sunPicker = document.getElementById('sun');
const subSunPicker = document.getElementById('subsun');
const sizeSelector = document.getElementById('mapSizeSelect');
let maxSize = parseInt(sizeSelector.value) + 1;

// Three.js Setup
const scene = new Scene();
scene.background = new Color('#FFEECC');

const camera = new PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 1000);
camera.position.set(-17, 50, 75);

const renderer = new WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = ACESFilmicToneMapping;
renderer.outputEncoding = sRGBEncoding;
renderer.physicallyCorrectLights = true;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// Lighting
const light = new PointLight(new Color(sunPicker.value).convertSRGBToLinear(), 80, 50);
light.position.set(10, 20, 10);
light.castShadow = true;
light.shadow.mapSize.width = 512;
light.shadow.mapSize.height = 512;
light.shadow.camera.near = 0.5;
light.shadow.camera.far = 500;
scene.add(light);

const sublight = new PointLight(new Color(subSunPicker.value).convertSRGBToLinear(), 80, 50);
sublight.position.set(-10, 20, -10);
sublight.castShadow = true;
sublight.shadow.mapSize.width = 512;
sublight.shadow.mapSize.height = 512;
sublight.shadow.camera.near = 0.5;
sublight.shadow.camera.far = 500;
scene.add(sublight);

// Event Listeners
sunPicker.addEventListener('input', () => {
    light.color = new Color(sunPicker.value).convertSRGBToLinear();
});

subSunPicker.addEventListener('input', () => {
    sublight.color = new Color(subSunPicker.value).convertSRGBToLinear();
});

sizeSelector.addEventListener('input', async () => {
    maxSize = parseInt(sizeSelector.value) + 1;
    await regenerateMap();
});

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.dampingFactor = 0.05;
controls.enableDamping = true;

// Map Constants
const MAX_HEIGHT = 10;
const STONE_HEIGHT = MAX_HEIGHT * 0.8;
const DIRT_HEIGHT = MAX_HEIGHT * 0.7;
const GRASS_HEIGHT = MAX_HEIGHT * 0.5;
const SAND_HEIGHT = MAX_HEIGHT * 0.3;
const DIRT2_HEIGHT = MAX_HEIGHT * 0;

// Geometry Containers
let stoneGeo = new BoxGeometry(0, 0, 0);
let dirtGeo = new BoxGeometry(0, 0, 0);
let dirt2Geo = new BoxGeometry(0, 0, 0);
let sandGeo = new BoxGeometry(0, 0, 0);
let grassGeo = new BoxGeometry(0, 0, 0);

// Environment Map
let envmap;

// Main Functions
async function regenerateMap() {
    clearMap();
    await createMap();
}

function clearMap() {
    // Remove and dispose all meshes
    resources.meshes.forEach(mesh => {
        scene.remove(mesh);
        if (mesh.geometry) {
            mesh.geometry.dispose();
            resources.geometries = resources.geometries.filter(g => g !== mesh.geometry);
        }
        if (mesh.material) {
            if (Array.isArray(mesh.material)) {
                mesh.material.forEach(m => m.dispose());
                resources.materials = resources.materials.filter(mat => !mesh.material.includes(mat));
            } else {
                mesh.material.dispose();
                resources.materials = resources.materials.filter(mat => mat !== mesh.material);
            }
        }
    });
    
    // Dispose remaining resources
    resources.geometries.forEach(geo => geo.dispose());
    resources.materials.forEach(mat => mat.dispose());
    resources.textures.forEach(tex => tex.dispose());
    resources.envmaps.forEach(env => env.dispose());
    
    // Clear all arrays
    resources.meshes = [];
    resources.geometries = [];
    resources.materials = [];
    resources.textures = [];
    resources.envmaps = [];
    
    // Reset base geometries
    stoneGeo = new BoxGeometry(0, 0, 0);
    dirtGeo = new BoxGeometry(0, 0, 0);
    dirt2Geo = new BoxGeometry(0, 0, 0);
    sandGeo = new BoxGeometry(0, 0, 0);
    grassGeo = new BoxGeometry(0, 0, 0);
}

async function createMap() {
    // Load environment map
    const pmrem = new PMREMGenerator(renderer);
    const envmapTexture = await new RGBELoader().setDataType(FloatType).loadAsync("assets/envmap.hdr");
    envmap = pmrem.fromEquirectangular(envmapTexture).texture;
    resources.envmaps.push(envmapTexture);

    // Load textures
    const textures = {
        dirt: await new TextureLoader().loadAsync("assets/dirt.png"),
        dirt2: await new TextureLoader().loadAsync("assets/dirt2.jpg"),
        grass: await new TextureLoader().loadAsync("assets/grass.jpg"),
        sand: await new TextureLoader().loadAsync("assets/sand.jpg"),
        water: await new TextureLoader().loadAsync("assets/water.jpg"),
        stone: await new TextureLoader().loadAsync("assets/snow.png"),
    };
    resources.textures.push(...Object.values(textures));

    // Generate terrain
    const simplex = new SimplexNoise();
    const sizeValue = parseInt(sizeSelector.value);

    for (let i = -sizeValue; i <= sizeValue; i++) {
        for (let j = -sizeValue; j <= sizeValue; j++) {
            const position = tileToPosition(i, j);
            if (position.length() > maxSize) continue;
            
            let noise = (simplex.noise2D(i * 0.1, j * 0.1) + 1) * 0.5;
            noise = Math.pow(noise, 1.5);
            makeHex(noise * MAX_HEIGHT, position);
        }
    }

    // Create terrain meshes
    const stoneMesh = hexMesh(stoneGeo, textures.stone);
    const grassMesh = hexMesh(grassGeo, textures.grass);
    const dirtMesh = hexMesh(dirtGeo, textures.dirt);
    const dirt2Mesh = hexMesh(dirt2Geo, textures.dirt2);
    const sandMesh = hexMesh(sandGeo, textures.sand);
    scene.add(stoneMesh, grassMesh, dirtMesh, dirt2Mesh, sandMesh);

    // Create water
    const seaTexture = textures.water;
    seaTexture.repeat = new Vector2(1, 1);
    seaTexture.wrapS = RepeatWrapping;
    seaTexture.wrapT = RepeatWrapping;

    const seaMesh = new Mesh(
        new CylinderGeometry((maxSize + 4), (maxSize + 4), MAX_HEIGHT * 0.2, 50),
        new MeshPhysicalMaterial({
            envMap: envmap,
            color: new Color("#55aaff").convertSRGBToLinear().multiplyScalar(3),
            ior: 1.4,
            transmission: 1,
            transparent: true,
            thickness: 1.5,
            envMapIntensity: 0.2,
            roughness: 1,
            metalness: 0.025,
            roughnessMap: seaTexture,
            metalnessMap: seaTexture,
        })
    );
    seaMesh.receiveShadow = true;
    seaMesh.rotation.y = -Math.PI * 0.333 * 0.5;
    seaMesh.position.set(0, MAX_HEIGHT * 0.1, 0);
    scene.add(seaMesh);
    resources.meshes.push(seaMesh);

    // Create map container
    const mapContainer = new Mesh(
        new CylinderGeometry((maxSize + 4.1), (maxSize + 4.1), MAX_HEIGHT * 0.25, 50, 3, true),
        new MeshPhysicalMaterial({
            envMap: envmap,
            map: textures.dirt,
            envMapIntensity: 0.2,
            side: DoubleSide,
        })
    );
    mapContainer.receiveShadow = true;
    mapContainer.position.set(0, MAX_HEIGHT * 0.125, 0);
    scene.add(mapContainer);
    resources.meshes.push(mapContainer);

    // Create map floor
    const mapFloor = new Mesh(
        new CylinderGeometry((maxSize + 6), (maxSize + 6), MAX_HEIGHT * 0.1, 50),
        new MeshPhysicalMaterial({
            envMap: envmap,
            map: textures.dirt2,
            envMapIntensity: 0.1,
            side: DoubleSide,
        })
    );
    mapFloor.receiveShadow = true;
    mapFloor.position.set(0, -MAX_HEIGHT * 0.05, 0);
    scene.add(mapFloor);
    resources.meshes.push(mapFloor);

    // Add clouds
    createClouds();

    // Start rendering loop
    renderer.setAnimationLoop(() => {
        renderer.render(scene, camera);
        controls.update();
    });
}

// Helper Functions
function tileToPosition(tileX, tileY) {
    return new Vector2((tileX + (tileY % 2) * 0.5) * 1.77, tileY * 1.535);
}

function hexGeometry(height, position) {
    const geo = new CylinderGeometry(1, 1, height, 6, 1, false);
    geo.translate(position.x, height * 0.5, position.y);
    return geo;
}

function makeHex(height, position) {
    const geo = hexGeometry(height, position);

    if (height > STONE_HEIGHT) {
        stoneGeo = mergeBufferGeometries([geo, stoneGeo]);
        if (Math.random() > 0.8) {
            stoneGeo = mergeBufferGeometries([stoneGeo, createStone(height, position)]);
        }
    } else if (height > DIRT_HEIGHT) {
        dirtGeo = mergeBufferGeometries([geo, dirtGeo]);
        if (Math.random() > 0.8) {
            grassGeo = mergeBufferGeometries([grassGeo, createTree(height, position)]);
        }
    } else if (height > GRASS_HEIGHT) {
        grassGeo = mergeBufferGeometries([geo, grassGeo]);
    } else if (height > SAND_HEIGHT) {
        sandGeo = mergeBufferGeometries([geo, sandGeo]);
        if (Math.random() > 0.8) {
            sandGeo = mergeBufferGeometries([sandGeo, createStone(height, position)]);
        }
    } else if (height > DIRT2_HEIGHT) {
        dirt2Geo = mergeBufferGeometries([geo, dirt2Geo]);
    }
}

function hexMesh(geo, map) {
    const mat = new MeshPhysicalMaterial({
        envMap: envmap,
        envMapIntensity: 0.135,
        flatShading: true,
        map
    });
    resources.materials.push(mat);
    resources.textures.push(map);

    const mesh = new Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    resources.meshes.push(mesh);
    resources.geometries.push(geo);
    
    return mesh;
}

function createStone(height, position) {
    const px = Math.random() * 0.4;
    const pz = Math.random() * 0.4;
    const geo = new SphereGeometry(Math.random() * 0.3 + 0.1, 7, 7);
    geo.translate(position.x + px, height, position.y + pz);
    return geo;
}

function createTree(height, position) {
    const treeHeight = Math.random() * 1 + 1.25;
    const geo = new CylinderGeometry(0, 1.5, treeHeight, 3);
    geo.translate(position.x, height + treeHeight * 0 + 1, position.y);
    const geo2 = new CylinderGeometry(0, 1.15, treeHeight, 3);
    geo2.translate(position.x, height + treeHeight * 0.6 + 1, position.y);
    const geo3 = new CylinderGeometry(0, 0.8, treeHeight, 3);
    geo3.translate(position.x, height + treeHeight * 1.25 + 1, position.y);
    return mergeBufferGeometries([geo, geo2, geo3]);
}

function createClouds() {
    let geo = new SphereGeometry(0, 0, 0);
    const count = Math.floor(Math.pow(Math.random(), 0.45) * 4);

    for (let i = 0; i < count; i++) {
        const puff1 = new SphereGeometry(1.2, 7, 7);
        const puff2 = new SphereGeometry(1.5, 7, 7);
        const puff3 = new SphereGeometry(0.9, 7, 7);

        puff1.translate(-1.85, Math.random() * 0.3, 0);
        puff2.translate(0, Math.random() * 0.3, 0);
        puff3.translate(1.85, Math.random() * 0.3, 0);

        const cloudGeo = mergeBufferGeometries([puff1, puff2, puff3]);
        cloudGeo.translate(
            Math.random() * (maxSize + 5) - 10,
            Math.random() * 10 + 7,
            Math.random() * (maxSize + 5) - 10
        );
        cloudGeo.rotateY(Math.random() * Math.PI * 2);
        geo = mergeBufferGeometries([geo, cloudGeo]);
    }

    const mesh = new Mesh(
        geo,
        new MeshStandardMaterial({
            envMap: envmap,
            envMapIntensity: 0.75,
            flatShading: true,
        })
    );
    scene.add(mesh);
    resources.meshes.push(mesh);
}

// Initialize the map
createMap();

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
